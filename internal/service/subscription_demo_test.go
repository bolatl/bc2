package service

import (
	"context"
	"reflect"
	"testing"

	"lovelab/internal/model"
)

func TestDemoAccessIgnoresPendingCheckoutWithoutChangingIt(t *testing.T) {
	app, actor, _ := fightApp(t, false)
	pending := model.Subscription{
		CoupleID: actor.CoupleID, Plan: "monthly", Status: "pending",
		CheckoutSessionID: "cs_mock_pending", CheckoutURL: "https://example.test/checkout",
	}
	app.Subscriptions.Put(actor.CoupleID, pending)
	app.Config.DisablePaywall = true
	sub, err := app.SubscriptionMe(actor)
	if err != nil || sub.Status != "active" || sub.ActivatedAt != nil {
		t.Fatalf("demo access still asks for payment or claims paid activation: %+v, %v", sub, err)
	}
	_, err = app.Checkout(context.Background(), actor, "monthly")
	errorStatus(t, err, 409)
	stored, _ := app.Subscriptions.Get(actor.CoupleID)
	if !reflect.DeepEqual(stored, pending) {
		t.Fatal("checking demo access changed the saved checkout")
	}
	app.Config.DisablePaywall = false
	sub, err = app.SubscriptionMe(actor)
	if err != nil || sub.Status != "pending" || sub.Plan != pending.Plan {
		t.Fatal("the original checkout was lost when demo access ended")
	}
}
