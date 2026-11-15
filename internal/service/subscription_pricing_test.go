package service

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	"lovelab/internal/llm"
	"lovelab/internal/model"
	"lovelab/internal/payment"
)

type unavailableCheckout struct{ payment.Client }

func (unavailableCheckout) CreateCheckout(context.Context, payment.CheckoutRequest) (payment.Checkout, error) {
	return payment.Checkout{}, payment.ErrProviderUnavailable
}

func TestCombinedPendingCheckoutRequiresSuccessfulSingleOptionReplacement(t *testing.T) {
	app, actor, _ := fightApp(t, false)
	const oldID = "cs_mock_combined"
	old := model.Subscription{CoupleID: actor.CoupleID, Plan: "yearly", Status: "pending", CheckoutSessionID: oldID, AddOns: []string{"date_night"}}
	app.Subscriptions.Put(actor.CoupleID, old)
	_, err := app.ConfirmCheckout(context.Background(), actor, oldID)
	errorStatus(t, err, 409)
	if !strings.Contains(err.Error(), "Choose one option") {
		t.Fatalf("wrong recovery guidance: %v", err)
	}
	_, err = app.Checkout(context.Background(), actor, "yearly", "date_night")
	errorStatus(t, err, 400)
	app.Payment = unavailableCheckout{payment.NewMock("http://localhost:5173")}
	_, err = app.Checkout(context.Background(), actor, "date_night")
	errorStatus(t, err, 502)
	stored, _ := app.Subscriptions.Get(actor.CoupleID)
	if stored.CheckoutSessionID != oldID || stored.Status != "pending" || len(stored.AddOns) != 1 {
		t.Fatal("failed replacement altered the existing checkout")
	}
	app.Payment = payment.NewMock("http://localhost:5173")
	checkout, err := app.Checkout(context.Background(), actor, "date_night")
	if err != nil || checkout.AmountUSD != 69 || checkout.CheckoutSessionID == oldID {
		t.Fatalf("wrong replacement: %+v %v", checkout, err)
	}
	stored, _ = app.Subscriptions.Get(actor.CoupleID)
	if stored.Plan != "date_night" || len(stored.AddOns) != 0 {
		t.Fatalf("combined selection remained: %+v", stored)
	}
	_, err = app.ConfirmCheckout(context.Background(), actor, oldID)
	errorStatus(t, err, 404)
	paid, err := app.ConfirmCheckout(context.Background(), actor, checkout.CheckoutSessionID)
	if err != nil || paid.Plan != "date_night" || paid.Status != "active" {
		t.Fatalf("replacement did not activate: %+v %v", paid, err)
	}
}

func TestAlreadyPaidLegacyCombinedRecordRetainsAccessAndData(t *testing.T) {
	app, actor, _ := fightApp(t, false)
	app.Subscriptions.Put(actor.CoupleID, model.Subscription{CoupleID: actor.CoupleID, Plan: "yearly", Status: "active", CheckoutSessionID: "paid-before-correction", AddOns: []string{"date_night"}})
	view, err := app.ConfirmCheckout(context.Background(), actor, "paid-before-correction")
	if err != nil || !app.active(actor.CoupleID) || view.Plan != "yearly" || len(view.AddOns) != 1 {
		t.Fatalf("paid legacy record changed: %+v %v", view, err)
	}
	view.AddOns[0] = "must-not-change-storage"
	path := filepath.Join(t.TempDir(), "legacy.json")
	stop := app.StartAutosave(path)
	stop()
	restored := New(app.Config, llm.NewMock(), nil)
	if err := restored.LoadFrom(path); err != nil {
		t.Fatal(err)
	}
	view, err = restored.SubscriptionMe(actor)
	if err != nil || !restored.active(actor.CoupleID) || len(view.AddOns) != 1 || view.AddOns[0] != "date_night" {
		t.Fatalf("paid legacy record lost: %+v %v", view, err)
	}
}

func TestPaywallOffersThreeExclusiveOptions(t *testing.T) {
	app, _, _ := fightApp(t, false)
	view := app.paywall(model.Couple{ProfileA: model.PartnerProfile{RelationshipStatus: "engaged"}})
	want := map[string]float64{"monthly": 19.99, "yearly": 199, "date_night": 69}
	if len(view.AvailablePlans) != len(want) {
		t.Fatalf("wrong plans: %+v", view.AvailablePlans)
	}
	for _, plan := range view.AvailablePlans {
		if plan.PriceUSD != want[plan.Plan] || plan.IsDefault != (plan.Plan == "yearly") {
			t.Fatalf("incorrect offer: %+v", plan)
		}
		delete(want, plan.Plan)
	}
	if len(want) != 0 {
		t.Fatalf("wrong catalogue: %+v", view)
	}
}

func TestPaidStandaloneDateNightSurvivesPersistenceAndUnlocksAccess(t *testing.T) {
	app, actor, _ := fightApp(t, false)
	app.Payment = payment.NewMock("http://localhost:5173")
	fight := startFight(t, app, actor)
	checkout, err := app.Checkout(context.Background(), actor, "date_night")
	if err != nil || checkout.AmountUSD != 69 {
		t.Fatalf("checkout: %+v %v", checkout, err)
	}
	paid, err := app.ConfirmCheckout(context.Background(), actor, checkout.CheckoutSessionID)
	if err != nil || paid.Plan != "date_night" || paid.Status != "active" || len(paid.AddOns) != 0 {
		t.Fatalf("wrong subscription: %+v %v", paid, err)
	}
	if getFight(t, app, actor, fight.SessionID).Tier != "full" {
		t.Fatal("subscription did not unlock the existing conversation")
	}
	path := filepath.Join(t.TempDir(), "snapshot.json")
	stop := app.StartAutosave(path)
	stop()
	restored := New(app.Config, llm.NewMock(), payment.NewMock("http://localhost:5173"))
	if err := restored.LoadFrom(path); err != nil {
		t.Fatal(err)
	}
	view, err := restored.SubscriptionMe(actor)
	if err != nil || !restored.active(actor.CoupleID) || view.Plan != "date_night" || len(view.AddOns) != 0 {
		t.Fatalf("persisted basket lost: %+v %v", view, err)
	}
}

func TestRetiredPlanPendingAndActiveRecordsRemainUsable(t *testing.T) {
	for _, legacy := range []struct {
		plan   string
		amount float64
	}{{"program", 149}, {"premium_monthly", 29.99}} {
		t.Run(legacy.plan, func(t *testing.T) {
			app, actor, _ := fightApp(t, false)
			app.Subscriptions.Put(actor.CoupleID, model.Subscription{CoupleID: actor.CoupleID, Plan: legacy.plan, Status: "pending", CheckoutSessionID: "cs_test_legacy", CheckoutURL: "https://checkout.stripe.com/legacy"})
			checkout, err := app.Checkout(context.Background(), actor, legacy.plan)
			if err != nil || checkout.CheckoutSessionID != "cs_test_legacy" || checkout.AmountUSD != legacy.amount {
				t.Fatalf("legacy pending checkout lost: %+v %v", checkout, err)
			}
			app.Subscriptions.Put(actor.CoupleID, model.Subscription{CoupleID: actor.CoupleID, Plan: legacy.plan, Status: "active"})
			view, err := app.SubscriptionMe(actor)
			if err != nil || view.Plan != legacy.plan || view.Status != "active" || !app.active(actor.CoupleID) {
				t.Fatalf("legacy paid access changed: %+v %v", view, err)
			}
			_, err = app.Checkout(context.Background(), actor, "yearly")
			errorStatus(t, err, 409)
		})
	}
}
