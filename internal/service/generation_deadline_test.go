package service

import (
	"context"
	"reflect"
	"sync"
	"testing"
	"time"

	"lovelab/internal/dto"
	"lovelab/internal/llm"
)

type deadlineLLM struct {
	mu        sync.Mutex
	inner     *llm.Mock
	deadlines []time.Time
	waitFinal bool
}

func (l *deadlineLLM) record(t context.Context) {
	l.mu.Lock()
	defer l.mu.Unlock()
	deadline, _ := t.Deadline()
	l.deadlines = append(l.deadlines, deadline)
}

func (l *deadlineLLM) NextTurn(ctx context.Context, in llm.Input) (llm.Question, error) {
	l.record(ctx)
	return l.inner.NextTurn(ctx, in)
}

func (l *deadlineLLM) ClassifyTopic(ctx context.Context, in llm.Input) (string, error) {
	l.record(ctx)
	return l.inner.ClassifyTopic(ctx, in)
}

func (l *deadlineLLM) FinalResult(ctx context.Context, in llm.Input) (llm.Result, error) {
	l.record(ctx)
	if l.waitFinal {
		<-ctx.Done()
		return llm.Result{}, ctx.Err()
	}
	return l.inner.FinalResult(ctx, in)
}

func (l *deadlineLLM) AnalyzeReflection(ctx context.Context, in llm.Input) (llm.Reflection, error) {
	l.record(ctx)
	return l.inner.AnalyzeReflection(ctx, in)
}

func TestGenerationCallsShareBoundedRequestDeadline(t *testing.T) {
	app, actor, _ := fightApp(t, true)
	client := &deadlineLLM{inner: llm.NewMock()}
	app.LLM = client
	before := time.Now()
	session := startFight(t, app, actor)
	if len(client.deadlines) != 1 || client.deadlines[0].Before(before.Add(requestGenerationTimeout-time.Second)) || client.deadlines[0].After(time.Now().Add(requestGenerationTimeout)) {
		t.Fatalf("start did not bound generation before the write timeout: %v", client.deadlines)
	}
	answerFight(t, app, actor, session.SessionID, "8")
	client.deadlines = nil
	answerFight(t, app, actor, session.SessionID, "We disagreed about the dishes.")
	if len(client.deadlines) < 2 {
		t.Fatalf("expected classification and question generation: %v", client.deadlines)
	}
	for _, deadline := range client.deadlines {
		if deadline.IsZero() || !deadline.Equal(client.deadlines[0]) {
			t.Fatalf("calls do not share an aggregate deadline: %v", client.deadlines)
		}
	}
}

func TestGenerationTimeoutKeepsReadinessAnswerUncommitted(t *testing.T) {
	app, actor, _ := fightApp(t, true)
	client := &deadlineLLM{inner: llm.NewMock()}
	app.LLM = client
	session := startFight(t, app, actor)
	for _, answer := range []string{"8", "We disagreed about dishes.", "I felt alone.", "I need a fair plan."} {
		answerFight(t, app, actor, session.SessionID, answer)
	}
	before, ok := app.Fights.Get(session.SessionID)
	if !ok || before.Stage != "ready" {
		t.Fatalf("expected ready stage, got %#v", before)
	}
	client.waitFinal = true
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Millisecond)
	defer cancel()
	index := before.Current.TurnIndex
	_, err := app.FightTurn(ctx, actor, session.SessionID, dto.SubmitTurnRequest{TurnIndex: &index, AnswerSource: "card_left"})
	if err == nil {
		t.Fatal("expected generation timeout")
	}
	after, _ := app.Fights.Get(session.SessionID)
	if !reflect.DeepEqual(before, after) {
		t.Fatalf("timeout committed a partial readiness answer: before=%+v after=%+v", before, after)
	}
}
