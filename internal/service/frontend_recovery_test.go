package service

import (
	"encoding/json"
	"testing"

	"lovelab/internal/dto"
	"lovelab/internal/model"
)

func TestFrontendRestoresOnlyOwnCurrentRoundAttempt(t *testing.T) {
	app, actorA, _ := fightApp(t, true)
	assertCurrent := func(actor model.Actor, id string) {
		t.Helper()
		me, err := app.CoupleMe(actor)
		if err != nil {
			t.Fatal(err)
		}
		if me.PartnerRole != actor.PartnerRole {
			t.Fatalf("wrong bootstrap role: %q", me.PartnerRole)
		}
		if id == "" {
			if me.CurrentSessionID != nil {
				t.Fatalf("unexpected bootstrap session: %q", *me.CurrentSessionID)
			}
		} else if me.CurrentSessionID == nil || *me.CurrentSessionID != id {
			t.Fatalf("bootstrap did not restore own session %s: %#v", id, me.CurrentSessionID)
		}
		data, err := json.Marshal(me)
		if err != nil {
			t.Fatal(err)
		}
		var payload map[string]any
		if err := json.Unmarshal(data, &payload); err != nil {
			t.Fatal(err)
		}
		if _, present := payload["currentSessionId"]; !present {
			t.Fatal("nullable bootstrap field omitted from JSON")
		}
	}
	assertCurrent(actorA, "")
	firstA := startFight(t, app, actorA)
	assertCurrent(actorA, firstA.SessionID)
	finishFight(t, app, actorA, firstA.SessionID)
	assertCurrent(actorA, firstA.SessionID)
	actorB := addPartner(t, app, actorA)
	assertCurrent(actorB, "")

	firstB := startFight(t, app, actorB)
	if _, err := app.FightSkip(actorB, firstB.SessionID); err != nil {
		t.Fatal(err)
	}
	assertCurrent(actorB, firstB.SessionID)
	secondB := startFight(t, app, actorB)
	assertCurrent(actorB, secondB.SessionID)
	// A private safety stop must remain recoverable only to its own browser.
	response := answerFight(t, app, actorB, secondB.SessionID, "I want to kill myself")
	if _, ok := response.(dto.SafetyStopResponse); !ok {
		t.Fatalf("expected private stop, got %#v", response)
	}
	assertCurrent(actorB, secondB.SessionID)
	assertCurrent(actorA, firstA.SessionID)
	thirdB := startFight(t, app, actorB)
	assertCurrent(actorB, thirdB.SessionID)
	finishFight(t, app, actorB, thirdB.SessionID)
	assertCurrent(actorB, thirdB.SessionID)

	secondA := startFight(t, app, actorA)
	assertCurrent(actorA, secondA.SessionID)
	assertCurrent(actorB, "") // B's previous-round ID must not be returned.
	_, err := app.FightGet(actorB, secondA.SessionID)
	errorStatus(t, err, 404)
}

func TestFrontendResultKeepsExactRoundRecord(t *testing.T) {
	app, actorA, _ := fightApp(t, false)
	firstA := startFight(t, app, actorA)
	reachPaywall(t, app, actorA, firstA.SessionID)
	preview, err := app.FightResult(actorA, firstA.SessionID)
	if err != nil || preview.FightRecordID != nil {
		t.Fatalf("preview has a record before both ready: %#v, %v", preview, err)
	}
	// Resume the paid session using the same state transition as confirmation.
	app.Subscriptions.Put(actorA.CoupleID, model.Subscription{CoupleID: actorA.CoupleID, Status: "active", Plan: "yearly"})
	saved, _ := app.Fights.Get(firstA.SessionID)
	saved.Status, saved.Tier = "in_progress", "full"
	app.Fights.Put(saved.ID, saved)
	finishFight(t, app, actorA, firstA.SessionID)
	beforeB, err := app.FightResult(actorA, firstA.SessionID)
	if err != nil || beforeB.FightRecordID != nil {
		t.Fatalf("record exposed before B is ready: %#v, %v", beforeB, err)
	}
	actorB := addPartner(t, app, actorA)
	firstB := startFight(t, app, actorB)
	finishFight(t, app, actorB, firstB.SessionID)
	firstResult, err := app.FightResult(actorA, firstA.SessionID)
	if err != nil || firstResult.FightRecordID == nil {
		t.Fatalf("missing first round record: %#v, %v", firstResult, err)
	}
	firstRecordID := *firstResult.FightRecordID
	bResult, err := app.FightResult(actorB, firstB.SessionID)
	if err != nil || bResult.FightRecordID == nil || *bResult.FightRecordID != firstRecordID {
		t.Fatalf("partners did not receive the same round record: %#v, %v", bResult, err)
	}
	secondA := startFight(t, app, actorA)
	finishFight(t, app, actorA, secondA.SessionID)
	secondB := startFight(t, app, actorB)
	finishFight(t, app, actorB, secondB.SessionID)
	secondResult, err := app.FightResult(actorA, secondA.SessionID)
	if err != nil || secondResult.FightRecordID == nil || *secondResult.FightRecordID == firstRecordID {
		t.Fatalf("new round did not get its own record: %#v, %v", secondResult, err)
	}
	oldResult, err := app.FightResult(actorA, firstA.SessionID)
	if err != nil || oldResult.FightRecordID == nil || *oldResult.FightRecordID != firstRecordID {
		t.Fatalf("old result points to the wrong round: %#v, %v", oldResult, err)
	}
	_, err = app.Rate(actorA, firstRecordID, nil)
	if err != nil {
		t.Fatalf("returned record cannot be rated: %v", err)
	}
}
