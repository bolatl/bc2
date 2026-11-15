package service

import (
	"context"
	"strings"
	"testing"

	"lovelab/internal/config"
	"lovelab/internal/llm"
	"lovelab/internal/model"
	"lovelab/internal/payment"
)

func TestPrototypeOnboardingStoresOnlyProvidedProfileAndNamesStayPrivate(t *testing.T) {
	app := New(config.Default(), llm.NewMock(), payment.NewMock("http://localhost:5173"))
	profile := model.PartnerProfile{PartnerName: "  Сэм  ", RelationshipStatus: "engaged", ConflictStyle: "need_space", RepairNeed: "closeness", Source: "friend"}
	response, actor, err := app.CreateCouple(profile)
	if err != nil || response.PartnerName != "Сэм" || response.DefaultPlan != "program" {
		t.Fatalf("minimal profile: %+v, %v", response, err)
	}
	stored, _ := app.Couples.Get(actor.CoupleID)
	if stored.ProfileA.Age != "" || stored.ProfileA.Goal != "" || stored.ProfileA.HasKids != "" || stored.ProfileA.TogetherDuration != "" || len(stored.ProfileA.FightTopics) != 0 || stored.ProfileA.Source != "friend" {
		t.Fatal("minimal profile received invented demographic data")
	}
	partner := addPartner(t, app, actor)
	view, err := app.CoupleMe(partner)
	if err != nil || view.PartnerName != "" {
		t.Fatalf("A's private name/profile appeared in B's context: %+v, %v", view, err)
	}
	input, err := app.fightInput(stored, model.FightSession{PartnerRole: "A"})
	if err != nil || input.Profile.PartnerName != "Сэм" {
		t.Fatalf("own profile name unavailable to generation: %+v, %v", input, err)
	}
}

func TestPrototypeOnboardingRejectsInvalidProvidedFields(t *testing.T) {
	base := model.PartnerProfile{PartnerName: "Sam", RelationshipStatus: "married", ConflictStyle: "talk_now", RepairNeed: "being_heard"}
	for _, mutate := range []func(*model.PartnerProfile){
		func(p *model.PartnerProfile) { p.PartnerName = strings.Repeat("я", 21) },
		func(p *model.PartnerProfile) { p.PartnerName = "   " },
		func(p *model.PartnerProfile) { p.PartnerName = "Sam\nName" },
		func(p *model.PartnerProfile) { p.Source = "unsupported" },
		func(p *model.PartnerProfile) { p.Age = "120" },
		func(p *model.PartnerProfile) { p.HasKids = "maybe" },
		func(p *model.PartnerProfile) { p.TogetherDuration = "forever" },
		func(p *model.PartnerProfile) { p.Goal = "invalid" },
		func(p *model.PartnerProfile) { p.FightTopics = []string{} },
		func(p *model.PartnerProfile) { p.ConflictStyle = "" },
		func(p *model.PartnerProfile) { p.RepairNeed = "" },
		func(p *model.PartnerProfile) { p.RelationshipStatus = "" },
	} {
		profile := base
		mutate(&profile)
		if validateProfile(profile, true) == nil {
			t.Errorf("accepted invalid provided profile: %+v", profile)
		}
	}
	base.PartnerName = strings.Repeat("я", 20)
	if err := validateProfile(base, true); err != nil {
		t.Fatalf("valid Unicode name was rejected: %v", err)
	}
}

func TestPrototypeRecommendedPlan(t *testing.T) {
	for _, status := range []string{"dating", "living_together", "married", "engaged"} {
		want := "yearly"
		if status == "engaged" {
			want = "program"
		}
		if got := defaultPlan(model.Couple{ProfileA: model.PartnerProfile{RelationshipStatus: status}}); got != want {
			t.Errorf("default plan for %s: got %s, want %s", status, got, want)
		}
	}
}

func TestPrototypePreviewUsesStoredRehearsalAndRetainsChosenOpening(t *testing.T) {
	app, actor, client := fightApp(t, false)
	app.Config.Funnel, app.Config.FreeTurns, app.Config.EnableRehearsal = "full", 5, true
	app.Payment = payment.NewMock("http://localhost:5173")
	fight := startFight(t, app, actor)
	for _, answer := range []string{"7", "I cleaned up the dishes alone.", "I felt alone.", "I wanted a clear plan.", "Maybe they were tired too."} {
		answerFight(t, app, actor, fight.SessionID, answer)
	}
	state := getFight(t, app, actor, fight.SessionID)
	if state.Status != "awaiting_payment" || state.Stage != "rehearsal" {
		t.Fatalf("wrong prototype paywall stage: %+v", state)
	}
	stored, _ := app.Fights.Get(fight.SessionID)
	calls := client.calls
	preview, err := app.FightResult(actor, fight.SessionID)
	if err != nil || preview.Rehearsal == nil || preview.Rehearsal.OptionA != stored.Current.OptionLeft || preview.Rehearsal.OptionB != stored.Current.OptionRight || preview.OpeningLine != "" || client.calls != calls {
		t.Fatalf("preview should reuse private saved options without generation: %+v, %v", preview, err)
	}
	partner := addPartner(t, app, actor)
	_, err = app.FightResult(partner, fight.SessionID)
	errorStatus(t, err, 404)
	checkout, err := app.Checkout(context.Background(), actor, "yearly")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = app.ConfirmCheckout(context.Background(), actor, checkout.CheckoutSessionID); err != nil {
		t.Fatal(err)
	}
	chosen := "I felt alone tonight. Could we plan cleanup together?"
	answerFight(t, app, actor, fight.SessionID, chosen)
	answerFight(t, app, actor, fight.SessionID, "4")
	answerFight(t, app, actor, fight.SessionID, "I am ready to talk")
	result, err := app.FightResult(actor, fight.SessionID)
	if err != nil || result.OpeningLine != chosen || result.Rehearsal != nil {
		t.Fatalf("chosen opening did not survive completion: %+v, %v", result, err)
	}
	stored, _ = app.Fights.Get(fight.SessionID)
	if len(stored.Turns) != 0 || stored.Current != nil {
		t.Fatal("retained raw answers after completing prototype flow")
	}
}

func TestRehearsalOpeningKeepsRespectfulSelectionOnly(t *testing.T) {
	app := New(config.Default(), llm.NewMock(), nil)
	for _, candidate := range []string{"You are an idiot.", "You are fucking wrong."} {
		result, err := app.resultFromInput(context.Background(), llm.Input{Turns: []llm.Turn{{Stage: "rehearsal", AnswerText: candidate}}})
		if err != nil || result.OpeningLine == candidate || !llm.RespectfulText(result.OpeningLine) {
			t.Fatalf("disrespectful rehearsal copied into result: %+v, %v", result, err)
		}
	}
	result, err := app.resultFromInput(context.Background(), llm.Input{Turns: []llm.Turn{{Stage: "rehearsal", AnswerText: "Can we talk after a short break?"}}})
	if err != nil || result.OpeningLine != "Can we talk after a short break?" {
		t.Fatalf("respectful edited rehearsal not retained: %+v, %v", result, err)
	}
}
