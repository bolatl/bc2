package service

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"sync"
	"testing"

	"lovelab/internal/config"
	"lovelab/internal/dto"
	"lovelab/internal/llm"
	"lovelab/internal/model"
)

type trackedLLM struct {
	inner        llm.Client
	calls        int
	seen         []llm.Input
	failNext     bool
	failClassify bool
	failFinal    bool
}

func (l *trackedLLM) NextTurn(ctx context.Context, in llm.Input) (llm.Question, error) {
	l.calls++
	l.seen = append(l.seen, in)
	if l.failNext {
		l.failNext = false
		return llm.Question{}, errors.New("unavailable")
	}
	return l.inner.NextTurn(ctx, in)
}
func (l *trackedLLM) ClassifyTopic(ctx context.Context, in llm.Input) (string, error) {
	l.calls++
	l.seen = append(l.seen, in)
	if l.failClassify {
		l.failClassify = false
		return "", errors.New("unavailable")
	}
	return l.inner.ClassifyTopic(ctx, in)
}
func (l *trackedLLM) FinalResult(ctx context.Context, in llm.Input) (llm.Result, error) {
	l.calls++
	l.seen = append(l.seen, in)
	if l.failFinal {
		l.failFinal = false
		return llm.Result{}, errors.New("unavailable")
	}
	return l.inner.FinalResult(ctx, in)
}

func fightApp(t *testing.T, paid bool) (*App, model.Actor, *trackedLLM) {
	t.Helper()
	client := &trackedLLM{inner: llm.NewMock()}
	app := New(config.Default(), client, nil)
	actor := model.Actor{CoupleID: "test-couple", PartnerRole: "A"}
	app.Couples.Put(actor.CoupleID, model.Couple{ID: actor.CoupleID, ProfileA: model.PartnerProfile{Age: "30-34", RelationshipStatus: "married", ConflictStyle: "talk_now", RepairNeed: "plan", Goal: "understand_each_other", FightTopics: []string{"chores"}}, PartnerBStatus: "not_invited", CreatedAt: app.Now()})
	if paid {
		app.Subscriptions.Put(actor.CoupleID, model.Subscription{CoupleID: actor.CoupleID, Status: "active", Plan: "yearly"})
	}
	return app, actor, client
}
func startFight(t *testing.T, app *App, actor model.Actor) dto.FightSessionResponse {
	t.Helper()
	f, err := app.FightStart(context.Background(), actor)
	if err != nil {
		t.Fatal(err)
	}
	return f
}
func getFight(t *testing.T, app *App, actor model.Actor, id string) dto.FightSessionResponse {
	t.Helper()
	f, err := app.FightGet(actor, id)
	if err != nil {
		t.Fatal(err)
	}
	return f
}
func answerFight(t *testing.T, app *App, actor model.Actor, id, text string) any {
	t.Helper()
	f := getFight(t, app, actor, id)
	turn, ok := f.CurrentTurn.(dto.NextTurnResponse)
	if !ok {
		t.Fatalf("expected next turn, got %#v", f.CurrentTurn)
	}
	result, err := app.FightTurn(context.Background(), actor, id, dto.SubmitTurnRequest{TurnIndex: cp(&turn.TurnIndex), AnswerSource: "free_text", AnswerText: text})
	if err != nil {
		t.Fatalf("answer at %s: %v", turn.Stage, err)
	}
	return result
}
func reachPaywall(t *testing.T, app *App, actor model.Actor, id string) {
	t.Helper()
	for _, text := range []string{"8", "We disagreed about dishes", "I felt alone, private-A-marker", "A clear plan"} {
		answerFight(t, app, actor, id, text)
	}
	f := getFight(t, app, actor, id)
	if f.Status != "awaiting_payment" {
		t.Fatalf("not paywalled: %#v", f)
	}
}
func finishFight(t *testing.T, app *App, actor model.Actor, id string) {
	t.Helper()
	for i := 0; i < 12; i++ {
		f := getFight(t, app, actor, id)
		if f.Status == "completed" {
			return
		}
		turn, ok := f.CurrentTurn.(dto.NextTurnResponse)
		if !ok {
			t.Fatalf("unexpected current turn: %#v", f.CurrentTurn)
		}
		answer := "I would like us to understand each other"
		switch turn.Stage {
		case "thermometer_start":
			answer = "8"
		case "thermometer_end":
			answer = "3"
		case "facts":
			answer = "We disagreed about dishes"
		case "feelings":
			answer = "I felt tired, private-" + actor.PartnerRole + "-marker"
		case "needs":
			answer = "A clear plan"
		case "ready":
			answer = "I am ready to talk"
		}
		answerFight(t, app, actor, id, answer)
	}
	t.Fatal("session did not finish")
}
func addPartner(t *testing.T, app *App, actor model.Actor) model.Actor {
	t.Helper()
	c, _ := app.Couples.Get(actor.CoupleID)
	c.ProfileB = &model.PartnerProfile{Age: "30-34", ConflictStyle: "need_space", RepairNeed: "alone_time"}
	app.Couples.Put(c.ID, c)
	return model.Actor{CoupleID: actor.CoupleID, PartnerRole: "B"}
}
func errorStatus(t *testing.T, err error, want int) {
	t.Helper()
	var e *Error
	if !errors.As(err, &e) || e.Status != want {
		t.Fatalf("got %v, want status %d", err, want)
	}
}

func TestFightPaywallResumePrivacyAndJournal(t *testing.T) {
	app, actor, client := fightApp(t, false)
	first := startFight(t, app, actor)
	reachPaywall(t, app, actor, first.SessionID)
	preview, err := app.FightResult(actor, first.SessionID)
	if err != nil {
		t.Fatal(err)
	}
	if preview.OpeningLine != "" || !reflect.DeepEqual(preview.Locked, []string{"openingLine", "inviteUrl"}) {
		t.Fatalf("unexpected free result: %#v", preview)
	}
	stored, _ := app.Fights.Get(first.SessionID)
	before := *stored.Current
	app.Subscriptions.Put(actor.CoupleID, model.Subscription{CoupleID: actor.CoupleID, Status: "active", Plan: "yearly"})
	stored.Tier = "full"
	stored.Status = "in_progress"
	app.Fights.Put(stored.ID, stored)
	resumed := getFight(t, app, actor, first.SessionID)
	turn := resumed.CurrentTurn.(dto.NextTurnResponse)
	if turn.TurnIndex != 4 || turn.AgentQuestion != before.AgentQuestion {
		t.Fatal("payment did not resume the saved question")
	}
	finishFight(t, app, actor, first.SessionID)
	stored, _ = app.Fights.Get(first.SessionID)
	if len(stored.Turns) != 0 || stored.Current != nil || stored.Result == nil {
		t.Fatalf("completed raw data retained: %#v", stored)
	}
	c, _ := app.Couples.Get(actor.CoupleID)
	if !c.InviteEnabled || c.InviteSentAt == nil {
		t.Fatal("A completion did not enable invite")
	}
	b := addPartner(t, app, actor)
	_, err = app.FightGet(b, first.SessionID)
	errorStatus(t, err, 404)
	_, err = app.FightResult(b, first.SessionID)
	errorStatus(t, err, 404)
	client.seen = nil
	second := startFight(t, app, b)
	for _, in := range client.seen {
		encoded, _ := json.Marshal(in)
		if strings.Contains(string(encoded), "private-A-marker") {
			t.Fatal("A answers leaked to B's LLM context")
		}
		if in.NeutralTopic != "chores" {
			t.Fatalf("B missing shared neutral topic: %#v", in)
		}
	}
	finishFight(t, app, b, second.SessionID)
	records := app.Journal.All()
	if len(records) != 1 || records[0].BothReadyAt == nil || records[0].Topic != "chores" || records[0].Color != "gray" {
		t.Fatalf("unexpected journal records: %#v", records)
	}
	result, err := app.FightResult(actor, first.SessionID)
	if err != nil {
		t.Fatal(err)
	}
	if result.OpeningLine == "" || len(result.Locked) != 0 || result.PartnerStatus != "ready" {
		t.Fatalf("unexpected full result: %#v", result)
	}
	encoded, _ := json.Marshal(records)
	if strings.Contains(string(encoded), "private-") {
		t.Fatal("raw text reached journal")
	}
}

func TestFightSafetyStopsBeforeLLMAndDoesNotNotifyPartner(t *testing.T) {
	app, actor, client := fightApp(t, true)
	first := startFight(t, app, actor)
	finishFight(t, app, actor, first.SessionID)
	b := addPartner(t, app, actor)
	second := startFight(t, app, b)
	answerFight(t, app, b, second.SessionID, "8")
	cBefore, _ := app.Couples.Get(actor.CoupleID)
	calls := client.calls
	response := answerFight(t, app, b, second.SessionID, "My partner hit me and I am in danger")
	stoppedResponse, ok := response.(dto.SafetyStopResponse)
	if !ok || len(stoppedResponse.Hotlines) != 3 {
		t.Fatalf("not safety response: %#v", response)
	}
	if client.calls != calls {
		t.Fatal("LLM called with unsafe text")
	}
	cAfter, _ := app.Couples.Get(actor.CoupleID)
	if !reflect.DeepEqual(cBefore, cAfter) {
		t.Fatal("safety stop changed partner-visible couple data")
	}
	stored, _ := app.Fights.Get(second.SessionID)
	if stored.Status != "stopped_safety" || len(stored.Turns) != 0 || stored.Current != nil || stored.Result != nil {
		t.Fatalf("unsafe session retains raw data: %#v", stored)
	}
	if len(app.Journal.All()) != 0 {
		t.Fatal("unsafe round appeared in journal")
	}
	retry := startFight(t, app, b)
	if retry.SessionID == second.SessionID || len(retry.Turns) != 0 {
		t.Fatal("B retry did not begin a fresh private session")
	}
	finishFight(t, app, b, retry.SessionID)
	if len(app.Journal.All()) != 1 {
		t.Fatal("retry could not complete round")
	}
}

func TestFightSafetyAlsoAppliesAtPaywallAndOnRewind(t *testing.T) {
	app, actor, client := fightApp(t, false)
	f := startFight(t, app, actor)
	reachPaywall(t, app, actor, f.SessionID)
	calls := client.calls
	stale := 0
	response, err := app.FightTurn(context.Background(), actor, f.SessionID, dto.SubmitTurnRequest{TurnIndex: &stale, AnswerSource: "card_left", AnswerText: "I want to kill myself"})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := response.(dto.SafetyStopResponse); !ok {
		t.Fatalf("unsafe paywall answer not stopped: %#v", response)
	}
	if client.calls != calls {
		t.Fatal("unsafe paywall answer reached LLM")
	}
	_, err = app.FightStart(context.Background(), actor)
	errorStatus(t, err, 402)

	app, actor, client = fightApp(t, true)
	f = startFight(t, app, actor)
	answerFight(t, app, actor, f.SessionID, "8")
	stored, _ := app.Fights.Get(f.SessionID)
	stored.Turns[0].AnswerText = "I want to kill myself"
	app.Fights.Put(stored.ID, stored)
	calls = client.calls
	rewound, err := app.FightBack(context.Background(), actor, f.SessionID, dto.BackRequest{TurnIndex: &stale})
	if err != nil {
		t.Fatal(err)
	}
	if rewound.Status != "stopped_safety" || client.calls != calls {
		t.Fatal("rewind failed pre-LLM safety gate")
	}
}

func TestFightRewindDeletesLaterBranchAndCannotBypassPaywall(t *testing.T) {
	app, actor, _ := fightApp(t, false)
	f := startFight(t, app, actor)
	reachPaywall(t, app, actor, f.SessionID)
	index := 1
	rewound, err := app.FightBack(context.Background(), actor, f.SessionID, dto.BackRequest{TurnIndex: &index})
	if err != nil {
		t.Fatal(err)
	}
	stored, _ := app.Fights.Get(f.SessionID)
	if len(stored.Turns) != 1 || stored.NeutralTopic != "" || stored.Result != nil || stored.ThermometerStart == nil || *stored.ThermometerStart != 8 {
		t.Fatalf("rewind retained invalid derived state: %#v", stored)
	}
	if turn := rewound.CurrentTurn.(dto.NextTurnResponse); turn.TurnIndex != 1 || turn.Stage != "facts" {
		t.Fatalf("wrong rewind turn: %#v", turn)
	}
	answerFight(t, app, actor, f.SessionID, "We disagreed about money")
	answerFight(t, app, actor, f.SessionID, "I felt tired")
	answerFight(t, app, actor, f.SessionID, "I needed space")
	stored, _ = app.Fights.Get(f.SessionID)
	if stored.Status != "awaiting_payment" || stored.NeutralTopic != "money" {
		t.Fatal("rewind bypassed paywall or retained old topic")
	}
	encoded, _ := json.Marshal(stored)
	if strings.Contains(string(encoded), "private-A-marker") {
		t.Fatal("discarded branch retained raw text")
	}
	current := stored.Current.TurnIndex
	response, err := app.FightTurn(context.Background(), actor, f.SessionID, dto.SubmitTurnRequest{TurnIndex: &current, AnswerSource: "free_text", AnswerText: "Keep going"})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := response.(dto.PaywallResponse); !ok {
		t.Fatalf("paywall bypass: %#v", response)
	}
}

func TestFightValidationAndGenerationFailureAreAtomic(t *testing.T) {
	app, actor, client := fightApp(t, true)
	f := startFight(t, app, actor)
	index := 0
	for _, req := range []dto.SubmitTurnRequest{{AnswerSource: "free_text", AnswerText: "8"}, {TurnIndex: &index, AnswerSource: "free_text", AnswerText: "11"}, {TurnIndex: &index, AnswerSource: "card_left", AnswerText: "different"}, {TurnIndex: &index, AnswerSource: "free_text", AnswerText: strings.Repeat("x", 4001)}} {
		_, err := app.FightTurn(context.Background(), actor, f.SessionID, req)
		errorStatus(t, err, 400)
	}
	bad := 1
	_, err := app.FightTurn(context.Background(), actor, f.SessionID, dto.SubmitTurnRequest{TurnIndex: &bad, AnswerSource: "free_text", AnswerText: "8"})
	errorStatus(t, err, 409)
	before, _ := app.Fights.Get(f.SessionID)
	client.failNext = true
	_, err = app.FightTurn(context.Background(), actor, f.SessionID, dto.SubmitTurnRequest{TurnIndex: &index, AnswerSource: "free_text", AnswerText: "8"})
	errorStatus(t, err, 503)
	after, _ := app.Fights.Get(f.SessionID)
	if !reflect.DeepEqual(before, after) {
		t.Fatal("failed generation changed stored state")
	}
	answerFight(t, app, actor, f.SessionID, "8")
	_, err = app.FightTurn(context.Background(), actor, f.SessionID, dto.SubmitTurnRequest{TurnIndex: &index, AnswerSource: "free_text", AnswerText: "8"})
	errorStatus(t, err, 409)
}

func TestFightRehearsalAndReadyConfirmation(t *testing.T) {
	for _, enabled := range []bool{false, true} {
		t.Run(strconvBool(enabled), func(t *testing.T) {
			app, actor, _ := fightApp(t, true)
			app.Config.EnableRehearsal = enabled
			f := startFight(t, app, actor)
			sawRehearsal := false
			for i := 0; i < 10; i++ {
				view := getFight(t, app, actor, f.SessionID)
				turn := view.CurrentTurn.(dto.NextTurnResponse)
				if turn.Stage == "ready" {
					break
				}
				if turn.Stage == "rehearsal" {
					sawRehearsal = true
				}
				answer := "I wanted a clear plan"
				if strings.HasPrefix(turn.Stage, "thermometer_") {
					answer = "3"
				}
				answerFight(t, app, actor, f.SessionID, answer)
			}
			if sawRehearsal != enabled {
				t.Fatalf("rehearsal=%v, enabled=%v", sawRehearsal, enabled)
			}
			ready := getFight(t, app, actor, f.SessionID).CurrentTurn.(dto.NextTurnResponse)
			_, err := app.FightTurn(context.Background(), actor, f.SessionID, dto.SubmitTurnRequest{TurnIndex: &ready.TurnIndex, AnswerSource: "free_text", AnswerText: "not ready"})
			errorStatus(t, err, 400)
			if _, err = app.FightTurn(context.Background(), actor, f.SessionID, dto.SubmitTurnRequest{TurnIndex: &ready.TurnIndex, AnswerSource: "card_right"}); err != nil {
				t.Fatal(err)
			}
			terminal := getFight(t, app, actor, f.SessionID)
			if terminal.Status != "completed" || len(terminal.Turns) != 0 {
				t.Fatal("completion failed")
			}
		})
	}
}
func strconvBool(value bool) string {
	if value {
		return "enabled"
	}
	return "disabled"
}

func TestFightConcurrentDuplicateAnswerAcceptedOnce(t *testing.T) {
	app, actor, _ := fightApp(t, true)
	f := startFight(t, app, actor)
	index := 0
	req := dto.SubmitTurnRequest{TurnIndex: &index, AnswerSource: "free_text", AnswerText: "8"}
	start := make(chan struct{})
	results := make(chan error, 2)
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			_, err := app.FightTurn(context.Background(), actor, f.SessionID, req)
			results <- err
		}()
	}
	close(start)
	wg.Wait()
	close(results)
	accepted, rejected := 0, 0
	for err := range results {
		if err == nil {
			accepted++
		} else {
			errorStatus(t, err, 409)
			rejected++
		}
	}
	if accepted != 1 || rejected != 1 {
		t.Fatalf("accepted=%d rejected=%d", accepted, rejected)
	}
	stored, _ := app.Fights.Get(f.SessionID)
	if len(stored.Turns) != 1 || stored.Current.TurnIndex != 1 {
		t.Fatalf("duplicate answer advanced session twice: %#v", stored)
	}
}

func TestFightClassifyAndFinalFailuresCanRetrySameTurn(t *testing.T) {
	app, actor, client := fightApp(t, true)
	f := startFight(t, app, actor)
	answerFight(t, app, actor, f.SessionID, "8")
	before, _ := app.Fights.Get(f.SessionID)
	index := 1
	client.failClassify = true
	_, err := app.FightTurn(context.Background(), actor, f.SessionID, dto.SubmitTurnRequest{TurnIndex: &index, AnswerSource: "free_text", AnswerText: "We argued about money"})
	errorStatus(t, err, 503)
	after, _ := app.Fights.Get(f.SessionID)
	if !reflect.DeepEqual(before, after) {
		t.Fatal("failed classifier committed a partial turn")
	}
	answerFight(t, app, actor, f.SessionID, "We argued about money")
	for {
		view := getFight(t, app, actor, f.SessionID)
		if view.Stage == "ready" {
			break
		}
		answer := "I want us to work together"
		if view.Stage == "thermometer_end" {
			answer = "3"
		}
		answerFight(t, app, actor, f.SessionID, answer)
	}
	before, _ = app.Fights.Get(f.SessionID)
	index = before.Current.TurnIndex
	client.failFinal = true
	_, err = app.FightTurn(context.Background(), actor, f.SessionID, dto.SubmitTurnRequest{TurnIndex: &index, AnswerSource: "free_text", AnswerText: "I am ready to talk"})
	errorStatus(t, err, 503)
	after, _ = app.Fights.Get(f.SessionID)
	if !reflect.DeepEqual(before, after) {
		t.Fatal("failed final generation committed readiness")
	}
	c, _ := app.Couples.Get(actor.CoupleID)
	if c.InviteEnabled {
		t.Fatal("failed final generation exposed invite")
	}
	answerFight(t, app, actor, f.SessionID, "I am ready to talk")
	if view := getFight(t, app, actor, f.SessionID); view.Status != "completed" {
		t.Fatal("ready retry failed")
	}
}

func TestFightNextRoundUsesFreshAssociation(t *testing.T) {
	app, actor, _ := fightApp(t, true)
	firstA := startFight(t, app, actor)
	finishFight(t, app, actor, firstA.SessionID)
	b := addPartner(t, app, actor)
	firstB := startFight(t, app, b)
	finishFight(t, app, b, firstB.SessionID)
	oldA, _ := app.Fights.Get(firstA.SessionID)
	secondA := startFight(t, app, actor)
	newA, _ := app.Fights.Get(secondA.SessionID)
	if oldA.RoundID == newA.RoundID {
		t.Fatal("new fight reused previous round")
	}
	c, _ := app.Couples.Get(actor.CoupleID)
	if c.InviteEnabled || c.InviteSentAt != nil || c.PartnerBStatus != "not_invited" {
		t.Fatal("new round exposed a premature invite")
	}
	_, err := app.FightStart(context.Background(), b)
	errorStatus(t, err, 409)
	answerFight(t, app, actor, secondA.SessionID, "8")
	answerFight(t, app, actor, secondA.SessionID, "We argued about money")
	finishFight(t, app, actor, secondA.SessionID)
	secondB := startFight(t, app, b)
	newB, _ := app.Fights.Get(secondB.SessionID)
	if newB.RoundID != newA.RoundID || newB.NeutralTopic != "money" {
		t.Fatalf("B joined incorrect round: %#v", newB)
	}
	finishFight(t, app, b, secondB.SessionID)
	oldRecord, ok := app.Journal.Get(oldA.RoundID)
	if !ok || oldRecord.Topic != "chores" {
		t.Fatal("new round overwrote previous journal")
	}
	newRecord, ok := app.Journal.Get(newA.RoundID)
	if !ok || newRecord.Topic != "money" {
		t.Fatal("new round missing from journal")
	}
}

func TestDisablePaywallGivesFullAccessWithoutPayment(t *testing.T) {
	app, actor, _ := fightApp(t, false)
	app.Config.DisablePaywall = true
	first := startFight(t, app, actor)
	if first.Tier != "full" {
		t.Fatalf("expected full tier, got %q", first.Tier)
	}
	finishFight(t, app, actor, first.SessionID)
	c, _ := app.Couples.Get(actor.CoupleID)
	if !c.InviteEnabled {
		t.Fatal("invite not enabled without payment")
	}
	b := addPartner(t, app, actor)
	second := startFight(t, app, b)
	finishFight(t, app, b, second.SessionID)
	if _, err := app.JournalList(actor); err != nil {
		t.Fatal(err)
	}
	result, err := app.FightResult(actor, first.SessionID)
	if err != nil || result.OpeningLine == "" || len(result.Locked) != 0 {
		t.Fatalf("unexpected result: %#v %v", result, err)
	}
	sub, err := app.SubscriptionMe(actor)
	if err != nil || sub.Status != "active" {
		t.Fatalf("unexpected subscription: %#v %v", sub, err)
	}
}
