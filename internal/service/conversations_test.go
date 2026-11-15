package service

import (
	"context"
	"encoding/json"
	"net/url"
	"strings"
	"testing"
	"time"

	"lovelab/internal/model"
	"lovelab/internal/payment"
)

func TestConversationHistoryIncludesUnpaidPreparationButOnlyOwnedMetadata(t *testing.T) {
	app, a, _ := fightApp(t, false)
	f := startFight(t, app, a)
	reachPaywall(t, app, a, f.SessionID)
	list, err := app.Conversations(a)
	if err != nil || len(list.Conversations) != 1 || list.CanStartNew {
		t.Fatalf("unpaid preparation missing: %+v, %v", list, err)
	}
	row := list.Conversations[0]
	if row.SessionID != f.SessionID || row.Status != "awaiting_payment" || !row.IsCurrent || !row.ResultAvailable || row.FightRecordID != nil || row.InviteURL != "" {
		t.Fatalf("incorrect unpaid row: %+v", row)
	}
	data, _ := json.Marshal(list)
	for _, private := range []string{"private-A-marker", "answerText", "feltText", "needText", "openingLine"} {
		if strings.Contains(string(data), private) {
			t.Fatalf("history disclosed private content %s", private)
		}
	}
	b := addPartner(t, app, a)
	bList, err := app.Conversations(b)
	if err != nil || len(bList.Conversations) != 0 || bList.CanStartNew {
		t.Fatalf("partner saw A's preparation: %+v, %v", bList, err)
	}
	_, outsider, err := app.CreateCouple(model.PartnerProfile{RelationshipStatus: "dating", ConflictStyle: "need_space", RepairNeed: "alone_time"})
	if err != nil {
		t.Fatal(err)
	}
	otherList, err := app.Conversations(outsider)
	if err != nil || len(otherList.Conversations) != 0 || !otherList.CanStartNew {
		t.Fatalf("foreign couple saw preparation: %+v, %v", otherList, err)
	}
	_, err = app.Conversations(model.Actor{CoupleID: "missing", PartnerRole: "A"})
	errorStatus(t, err, 401)
}

func TestPaidConversationsReusePlanAndRotateInvitationPerRound(t *testing.T) {
	app, a, _ := fightApp(t, false)
	app.Payment = payment.NewMock("http://localhost:5173")
	first := startFight(t, app, a)
	reachPaywall(t, app, a, first.SessionID)
	checkout, err := app.Checkout(context.Background(), a, "yearly")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = app.ConfirmCheckout(context.Background(), a, checkout.CheckoutSessionID); err != nil {
		t.Fatal(err)
	}
	finishFight(t, app, a, first.SessionID)
	me, _ := app.CoupleMe(a)
	firstURL := me.InviteURL
	if firstURL == "" {
		t.Fatal("first completed conversation has no invitation")
	}
	ready, _ := app.Conversations(a)
	if !ready.CanStartNew {
		t.Fatal("A cannot start another conversation while the partner has not started")
	}
	// Make the order deterministic without relying on wall-clock timing.
	now := app.Now().Add(time.Minute)
	app.Now = func() time.Time { return now }
	second := startFight(t, app, a)
	if second.Tier != "full" || second.SessionID == first.SessionID {
		t.Fatal("new preparation did not inherit paid access")
	}
	me, _ = app.CoupleMe(a)
	if me.InviteURL != "" || me.PartnerStatus != "not_started" {
		t.Fatalf("new round reused readiness or invitation: %+v", me)
	}
	oldToken, _ := url.Parse(firstURL)
	_, err = app.InvitePreview(strings.TrimPrefix(oldToken.Path, "/invites/"))
	errorStatus(t, err, 404)
	finishFight(t, app, a, second.SessionID)
	me, _ = app.CoupleMe(a)
	if me.InviteURL == "" || me.InviteURL == firstURL {
		t.Fatal("new conversation did not issue a new invitation")
	}
	_, err = app.InvitePreview(strings.TrimPrefix(oldToken.Path, "/invites/"))
	errorStatus(t, err, 404)
	newToken, _ := url.Parse(me.InviteURL)
	if _, err = app.InvitePreview(strings.TrimPrefix(newToken.Path, "/invites/")); err != nil {
		t.Fatalf("new invitation is not usable: %v", err)
	}
	list, err := app.Conversations(a)
	if err != nil || len(list.Conversations) != 2 || list.Conversations[0].SessionID != second.SessionID || !list.Conversations[0].IsCurrent || list.Conversations[1].IsCurrent {
		t.Fatalf("current/history ordering incorrect: %+v, %v", list, err)
	}
	if list.Conversations[0].InviteURL != me.InviteURL || list.Conversations[1].InviteURL != "" {
		t.Fatal("history exposed an invitation for the wrong round")
	}
	if _, err = app.FightResult(a, first.SessionID); err != nil {
		t.Fatal("starting a new conversation removed the old private result")
	}
	subscription, _ := app.Subscriptions.Get(a.CoupleID)
	if subscription.Status != "active" || subscription.CheckoutSessionID != checkout.CheckoutSessionID {
		t.Fatal("starting another conversation replaced the original paid subscription")
	}
}

func TestPartnerStatusAndHistoryDoNotRevealPrivateStopOrProfile(t *testing.T) {
	app, a, _ := fightApp(t, true)
	c, _ := app.Couples.Get(a.CoupleID)
	c.ProfileA.Source = "friend"
	c.ProfileA.PartnerName = "PRIVATE_A_NAME"
	app.Couples.Put(c.ID, c)
	b := addPartner(t, app, a)
	aFight := startFight(t, app, a)
	bMe, _ := app.CoupleMe(b)
	if bMe.PartnerStatus != "in_progress" || bMe.OwnProfile == nil || bMe.OwnProfile.ConflictStyle != "need_space" || bMe.OwnProfile.Source != "" || bMe.OwnProfile.PartnerName != "" {
		t.Fatalf("B got incorrect readiness or A's profile: %+v", bMe)
	}
	finishFight(t, app, a, aFight.SessionID)
	bMe, _ = app.CoupleMe(b)
	if bMe.PartnerStatus != "ready" {
		t.Fatal("B cannot see when A is ready")
	}
	bFight := startFight(t, app, b)
	aMe, _ := app.CoupleMe(a)
	before, _ := app.Conversations(a)
	if aMe.PartnerStatus != "in_progress" || before.CanStartNew || aMe.OwnProfile.Source != "friend" {
		t.Fatalf("A got incorrect status or profile: %+v", aMe)
	}
	_, err := app.FightStart(context.Background(), a)
	errorStatus(t, err, 409)
	answerFight(t, app, b, bFight.SessionID, "I want to kill myself")
	aMeAfter, _ := app.CoupleMe(a)
	after, _ := app.Conversations(a)
	beforeJSON, _ := json.Marshal(before)
	afterJSON, _ := json.Marshal(after)
	if aMeAfter.PartnerStatus != aMe.PartnerStatus || string(beforeJSON) != string(afterJSON) {
		t.Fatal("partner learned about a private safety stop")
	}
	_, err = app.FightStart(context.Background(), a)
	errorStatus(t, err, 409)
	// The owner may restart privately, then readiness and shared history update.
	bRetry := startFight(t, app, b)
	finishFight(t, app, b, bRetry.SessionID)
	aMeAfter, _ = app.CoupleMe(a)
	after, _ = app.Conversations(a)
	if aMeAfter.PartnerStatus != "ready" || !after.CanStartNew || after.Conversations[0].FightRecordID == nil {
		t.Fatalf("completed partner not reflected: %+v", after)
	}
	bList, _ := app.Conversations(b)
	for _, row := range bList.Conversations {
		if row.SessionID == aFight.SessionID || row.InviteURL != "" {
			t.Fatal("B's history contains A's session or invite")
		}
	}
	// The latest completed retry is current, not the earlier private stop.
	currentCount := 0
	for _, row := range bList.Conversations {
		if row.IsCurrent {
			currentCount++
			if row.SessionID != bRetry.SessionID {
				t.Fatal("wrong B attempt marked current")
			}
		}
	}
	if currentCount != 1 {
		t.Fatal("ambiguous current conversation")
	}
}

func TestPastResultKeepsItsOwnRoundPartnerStatus(t *testing.T) {
	app, a, _ := fightApp(t, true)
	first := startFight(t, app, a)
	finishFight(t, app, a, first.SessionID)
	assertStatus := func(id, want string) {
		t.Helper()
		result, err := app.FightResult(a, id)
		if err != nil || result.PartnerStatus != want {
			t.Fatalf("result readiness: got %q, want %q, error %v", result.PartnerStatus, want, err)
		}
	}
	assertStatus(first.SessionID, "invited")
	second := startFight(t, app, a)
	assertStatus(first.SessionID, "invited")
	finishFight(t, app, a, second.SessionID)
	b := addPartner(t, app, a)
	bFight := startFight(t, app, b)
	assertStatus(second.SessionID, "in_progress")
	assertStatus(first.SessionID, "invited")
	finishFight(t, app, b, bFight.SessionID)
	assertStatus(second.SessionID, "ready")
	assertStatus(first.SessionID, "invited")
	startFight(t, app, a)
	assertStatus(second.SessionID, "ready")
	assertStatus(first.SessionID, "invited")
}
