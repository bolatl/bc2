package llm

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

type reflectionCallback func(context.Context, string, any) error

func (c reflectionCallback) complete(ctx context.Context, _ string, _ map[string]any, task string, _ Input, dst any) error {
	return c(ctx, task, dst)
}

func TestReflectionSkipsRepairWhenRequestHasTooLittleTime(t *testing.T) {
	calls := 0
	client := reflectionCallback(func(ctx context.Context, _ string, dst any) error {
		calls++
		valid, _ := NewMock().AnalyzeReflection(ctx, Input{})
		valid.Facets[0].Practice = "Take a 10 minute pause."
		*dst.(*Reflection) = valid
		return nil
	})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	got, err := newGenerator(client).AnalyzeReflection(ctx, Input{})
	if err != nil || reflectionProblem(got) != "" || calls != 1 || !strings.Contains(got.Summary, "basic reflection") {
		t.Fatalf("invalid reflection trapped a short-budget request: calls=%d err=%v result=%+v", calls, err, got)
	}
}

func TestReflectionRepairTimeoutReturnsLabelledBasicReflection(t *testing.T) {
	calls := 0
	client := reflectionCallback(func(ctx context.Context, task string, dst any) error {
		calls++
		if calls == 2 {
			if !strings.Contains(task, "facet 1 practice: numerical digits in prose") {
				t.Fatal("repair instruction omitted the actual validation failure")
			}
			return context.DeadlineExceeded
		}
		valid, _ := NewMock().AnalyzeReflection(ctx, Input{})
		valid.Facets[0].Practice = "Take a 10 minute pause."
		*dst.(*Reflection) = valid
		return nil
	})
	got, err := newGenerator(client).AnalyzeReflection(context.Background(), Input{})
	if err != nil || calls != 2 || reflectionProblem(got) != "" || !strings.Contains(got.Summary, "basic reflection") {
		t.Fatalf("repair timeout should not fail the turn: calls=%d err=%v result=%+v", calls, err, got)
	}
}

func TestReflectionFirstAttemptTimeoutUsesBasicReflection(t *testing.T) {
	client := reflectionCallback(func(context.Context, string, any) error { return context.DeadlineExceeded })
	got, err := newGenerator(client).AnalyzeReflection(context.Background(), Input{})
	if err != nil || reflectionProblem(got) != "" || !strings.Contains(got.Summary, "basic reflection") {
		t.Fatalf("reflection timeout blocked the turn: err=%v result=%+v", err, got)
	}
}

func TestReflectionDoesNotHideParentCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	client := reflectionCallback(func(context.Context, string, any) error {
		cancel()
		return context.Canceled
	})
	if _, err := newGenerator(client).AnalyzeReflection(ctx, Input{}); !errors.Is(err, context.Canceled) {
		t.Fatalf("parent cancellation was hidden: %v", err)
	}
}

func TestReflectionLeavesTimeForHTTPResponse(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	parentDeadline, _ := ctx.Deadline()
	client := reflectionCallback(func(ctx context.Context, _ string, dst any) error {
		deadline, ok := ctx.Deadline()
		if !ok || parentDeadline.Sub(deadline) < reflectionResponseReserve-10*time.Millisecond {
			t.Fatal("reflection used the entire HTTP request deadline")
		}
		valid, _ := NewMock().AnalyzeReflection(ctx, Input{})
		*dst.(*Reflection) = valid
		return nil
	})
	if _, err := newGenerator(client).AnalyzeReflection(ctx, Input{}); err != nil {
		t.Fatal(err)
	}
}

func TestReflectionValidationReasonDoesNotIncludePrivateText(t *testing.T) {
	valid, _ := NewMock().AnalyzeReflection(context.Background(), Input{})
	valid.Facets[0].Explanation = strings.Repeat("private-marker ", 46)
	problem := reflectionProblem(valid)
	if problem != "facet 1 explanation: word limit exceeded" || strings.Contains(problem, "private-marker") {
		t.Fatalf("unhelpful or unsafe diagnostic: %q", problem)
	}
}
