package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"lovelab/internal/dto"
	"lovelab/internal/llm"
	"lovelab/internal/model"
)

func TestReflectionPreviewRevealsExplanationsAndGatesPractice(t *testing.T) {
	app, actor, _ := fightApp(t, false)
	app.LLM = llm.NewMock()
	fight := startFight(t, app, actor)
	reachPaywall(t, app, actor, fight.SessionID)
	preview, err := app.FightResult(actor, fight.SessionID)
	if err != nil || preview.Reflection == nil || len(preview.Reflection.Facets) < 3 {
		t.Fatalf("missing reflection: %+v %v", preview.Reflection, err)
	}
	for _, facet := range preview.Reflection.Facets {
		if facet.Label == "" || facet.Explanation == "" || facet.Practice != nil {
			t.Fatalf("wrong preview visibility: %+v", facet)
		}
	}
	raw, _ := json.Marshal(preview)
	if strings.Contains(string(raw), "private-A-marker") {
		t.Fatal("raw answer leaked into derived response")
	}
	app.Subscriptions.Put(actor.CoupleID, model.Subscription{CoupleID: actor.CoupleID, Status: "active", Plan: "monthly"})
	full, err := app.FightResult(actor, fight.SessionID)
	if err != nil {
		t.Fatal(err)
	}
	for _, facet := range full.Reflection.Facets {
		if facet.Practice == nil || *facet.Practice == "" {
			t.Fatalf("active plan did not unlock practice: %+v", facet)
		}
	}
	_, err = app.FightResult(model.Actor{CoupleID: actor.CoupleID, PartnerRole: "B"}, fight.SessionID)
	errorStatus(t, err, 401)
}

type failingReflectionClient struct{ *llm.Mock }

func (f failingReflectionClient) AnalyzeReflection(context.Context, llm.Input) (llm.Reflection, error) {
	return llm.Reflection{}, errors.New("synthetic unavailable")
}

func TestReflectionFailureDoesNotCommitTheSubmittedAnswer(t *testing.T) {
	app, actor, _ := fightApp(t, false)
	app.LLM = failingReflectionClient{llm.NewMock()}
	fight := startFight(t, app, actor)
	for _, answer := range []string{"8", "We disagreed about dishes", "I felt alone"} {
		answerFight(t, app, actor, fight.SessionID, answer)
	}
	_, err := app.FightTurn(context.Background(), actor, fight.SessionID, dto.SubmitTurnRequest{TurnIndex: func() *int { index := 3; return &index }(), AnswerSource: "free_text", AnswerText: "A clear plan"})
	errorStatus(t, err, 503)
	state, _ := app.Fights.Get(fight.SessionID)
	if len(state.Turns) != 3 || state.Stage != "needs" || state.Result != nil {
		t.Fatalf("failed reflection committed partial state: %+v", state)
	}
}

func TestStoredReflectionIsClonedAndSurvivesCompletedSnapshot(t *testing.T) {
	app, actor, _ := fightApp(t, true)
	app.LLM = llm.NewMock()
	fight := startFight(t, app, actor)
	finishFight(t, app, actor, fight.SessionID)
	stored, _ := app.Fights.Get(fight.SessionID)
	if stored.Result.Reflection == nil || len(stored.Turns) != 0 {
		t.Fatal("completed reflection missing or raw history retained")
	}
	stored.Result.Reflection.Facets[0].Explanation = "changed outside repository"
	unchanged, _ := app.Fights.Get(fight.SessionID)
	if unchanged.Result.Reflection.Facets[0].Explanation == "changed outside repository" {
		t.Fatal("reflection aliases repository storage")
	}
	path := t.TempDir() + "/snapshot.json"
	stop := app.StartAutosave(path)
	stop()
	restored, _, _ := fightApp(t, true)
	if err := restored.LoadFrom(path); err != nil {
		t.Fatal(err)
	}
	result, err := restored.FightResult(actor, fight.SessionID)
	if err != nil || result.Reflection == nil || result.Reflection.Facets[0].Practice == nil {
		t.Fatalf("reflection did not survive snapshot: %+v %v", result.Reflection, err)
	}
}
