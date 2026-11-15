package service

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	"lovelab/internal/dto"
	"lovelab/internal/llm"
	"lovelab/internal/model"
)

type generationStarted struct {
	kind     string
	input    llm.Input
	deadline time.Time
}

type controlledReflectionClient struct {
	*llm.Mock
	started  chan generationStarted
	finished chan string
	release  map[string]chan struct{}
	failPart string
}

func newControlledReflectionClient() *controlledReflectionClient {
	return &controlledReflectionClient{
		Mock: llm.NewMock(), started: make(chan generationStarted, 2), finished: make(chan string, 2),
		release: map[string]chan struct{}{"result": make(chan struct{}), "reflection": make(chan struct{})},
	}
}

func (c *controlledReflectionClient) wait(ctx context.Context, kind string, input llm.Input) error {
	deadline, _ := ctx.Deadline()
	c.started <- generationStarted{kind: kind, input: input, deadline: deadline}
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-c.release[kind]:
		if c.failPart == kind {
			return errors.New("synthetic generation failure")
		}
		return nil
	}
}

func (c *controlledReflectionClient) FinalResult(ctx context.Context, input llm.Input) (llm.Result, error) {
	defer func() { c.finished <- "result" }()
	if err := c.wait(ctx, "result", input); err != nil {
		return llm.Result{}, err
	}
	return c.Mock.FinalResult(ctx, input)
}

func (c *controlledReflectionClient) AnalyzeReflection(ctx context.Context, input llm.Input) (llm.Reflection, error) {
	defer func() { c.finished <- "reflection" }()
	if err := c.wait(ctx, "reflection", input); err != nil {
		return llm.Reflection{}, err
	}
	return c.Mock.AnalyzeReflection(ctx, input)
}

func receiveGeneration[T any](t *testing.T, ch <-chan T) T {
	t.Helper()
	select {
	case result := <-ch:
		return result
	case <-time.After(3 * time.Second):
		t.Fatal("generation did not reach the expected synchronization point")
		var zero T
		return zero
	}
}

func beforeReflectionTurn(t *testing.T, paid bool) (*App, model.Actor, model.FightSession, dto.SubmitTurnRequest) {
	t.Helper()
	app, actor, _ := fightApp(t, paid)
	app.LLM = llm.NewMock()
	session := startFight(t, app, actor)
	answers := []string{"8", "We disagreed about the dishes.", "I felt unheard."}
	if paid {
		answers = append(answers, "I need time to explain.")
	}
	for _, answer := range answers {
		answerFight(t, app, actor, session.SessionID, answer)
	}
	before, _ := app.Fights.Get(session.SessionID)
	answer := "I need time to explain."
	if paid {
		answer = "I am ready to talk"
	}
	return app, actor, before, dto.SubmitTurnRequest{TurnIndex: cp(&before.Current.TurnIndex), AnswerSource: "free_text", AnswerText: answer}
}

func TestReflectionAndResultRunTogetherAndCommitTogether(t *testing.T) {
	for _, paid := range []bool{false, true} {
		name, wantStatus := "paywall", "awaiting_payment"
		if paid {
			name, wantStatus = "completed", "completed"
		}
		t.Run(name, func(t *testing.T) {
			app, actor, before, request := beforeReflectionTurn(t, paid)
			client := newControlledReflectionClient()
			app.LLM = client
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			done := make(chan error, 1)
			go func() {
				_, err := app.FightTurn(ctx, actor, before.ID, request)
				done <- err
			}()
			first := receiveGeneration(t, client.started)
			second := receiveGeneration(t, client.started)
			if first.kind == second.kind || !reflect.DeepEqual(first.input, second.input) {
				t.Fatal("generation did not start both independent outputs with the same owned input")
			}
			if first.deadline.IsZero() || !first.deadline.Equal(second.deadline) {
				t.Fatal("parallel generation did not share the request deadline")
			}
			if last := first.input.Turns[len(first.input.Turns)-1]; last.AnswerText != request.AnswerText {
				t.Fatal("generation did not receive the submitted answer")
			}
			close(client.release["result"])
			if receiveGeneration(t, client.finished) != "result" {
				t.Fatal("reflection unexpectedly finished before being released")
			}
			select {
			case <-done:
				t.Fatal("request completed before reflection finished")
			default:
			}
			interim, _ := app.Fights.Get(before.ID)
			if !reflect.DeepEqual(before, interim) {
				t.Fatal("part of the result was committed before both generations completed")
			}
			close(client.release["reflection"])
			if err := receiveGeneration(t, done); err != nil {
				t.Fatal(err)
			}
			after, _ := app.Fights.Get(before.ID)
			if after.Status != wantStatus || after.Result == nil || after.Result.Reflection == nil {
				t.Fatal("complete result and reflection were not committed together")
			}
		})
	}
}

func TestParallelGenerationFailureCancelsAndJoinsWithoutCommitting(t *testing.T) {
	for _, failedPart := range []string{"result", "reflection", "parent"} {
		t.Run(failedPart, func(t *testing.T) {
			app, actor, before, request := beforeReflectionTurn(t, false)
			coupleBefore, _ := app.Couples.Get(actor.CoupleID)
			client := newControlledReflectionClient()
			client.failPart = failedPart
			app.LLM = client
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			done := make(chan error, 1)
			go func() {
				_, err := app.FightTurn(ctx, actor, before.ID, request)
				done <- err
			}()
			receiveGeneration(t, client.started)
			receiveGeneration(t, client.started)
			if failedPart == "parent" {
				cancel()
			} else {
				close(client.release[failedPart])
			}
			errorStatus(t, receiveGeneration(t, done), 503)
			// Both workers have reported finishing before the request returns;
			// its sibling must have honored cancellation rather than remaining blocked.
			if len(client.finished) != 2 {
				t.Fatal("request returned without joining both generation workers")
			}
			after, _ := app.Fights.Get(before.ID)
			coupleAfter, _ := app.Couples.Get(actor.CoupleID)
			if !reflect.DeepEqual(before, after) || !reflect.DeepEqual(coupleBefore, coupleAfter) {
				t.Fatal("failed parallel generation committed an answer, result, or partner-visible state")
			}
		})
	}
}

func TestResultWithoutReflectionClientRemainsOneCall(t *testing.T) {
	app, actor, client := fightApp(t, false)
	couple, _ := app.Couples.Get(actor.CoupleID)
	session := model.FightSession{CoupleID: actor.CoupleID, PartnerRole: actor.PartnerRole}
	if err := app.generateResultWithReflection(context.Background(), couple, &session); err != nil {
		t.Fatal(err)
	}
	if client.calls != 1 || session.Result == nil || session.Result.Reflection != nil {
		t.Fatal("legacy generation client no longer uses exactly one result call")
	}
}
