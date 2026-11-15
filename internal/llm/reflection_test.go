package llm

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestReflectionMockUsesOwnContextWithoutScoring(t *testing.T) {
	inputs := []Input{
		{Turns: []Turn{{Stage: "facts", AnswerText: "I shouted about the dishes."}, {Stage: "feelings", AnswerText: "I felt unheard."}}},
		{Turns: []Turn{{Stage: "facts", AnswerText: "I listened to my partner before I explained my view."}, {Stage: "feelings", AnswerText: "I felt worried."}, {Stage: "needs", AnswerText: "A plan to split our work."}}},
		{Profile: Profile{ConflictStyle: "need_space", RepairNeed: "alone_time", TraitLevels: map[string]string{"e": "low"}}, Turns: []Turn{{Stage: "facts", AnswerText: "We disagreed about money."}}},
		{},
	}
	results := make([]Reflection, len(inputs))
	for i, in := range inputs {
		result, err := NewMock().AnalyzeReflection(context.Background(), in)
		if err != nil || reflectionProblem(result) != "" {
			t.Fatalf("case %d invalid reflection: %+v, %v, %s", i, result, err, reflectionProblem(result))
		}
		results[i] = result
	}
	if !hasFacet(results[0], "slowing_reactions") || hasFacet(results[1], "slowing_reactions") {
		t.Fatal("reactivity should follow own self-reported reaction")
	}
	if !hasFacet(results[1], "listening") || hasFacet(results[0], "listening") {
		t.Fatal("listening should need own evidence")
	}
	if !hasFacet(results[2], "making_space") || hasFacet(results[2], "slowing_reactions") {
		t.Fatal("a stated need for space is not a negative personality label")
	}
}

func TestReflectionMockDoesNotAttributePartnerReactionToOwner(t *testing.T) {
	result, err := NewMock().AnalyzeReflection(context.Background(), Input{Turns: []Turn{
		{Stage: "facts", AnswerText: "My partner shouted and never listened."},
		{Stage: "feelings", AnswerText: "I felt hurt and wanted to talk."},
	}})
	if err != nil || hasFacet(result, "slowing_reactions") || hasFacet(result, "listening") {
		t.Fatalf("attributed partner behavior: %+v, %v", result, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := NewMock().AnalyzeReflection(ctx, Input{}); !errors.Is(err, context.Canceled) {
		t.Fatal("ignored cancellation")
	}
}

func TestReflectionMockAvoidsIncidentalQuotedAndHypotheticalBehavior(t *testing.T) {
	for _, text := range []string{
		"I listened to a podcast while cleaning.",
		"I asked how much rent we needed to pay.",
		`My partner said, "I shouted because I was upset."`,
		"My partner said I shouted.",
		"If I shouted, that would make things harder.",
		"I never said I shouted.",
		"Maybe I interrupted them, but I cannot remember.",
		`“I listened to my partner” was their example of a good answer.`,
		"Если я кричала, я бы извинилась.",
	} {
		reflection, err := NewMock().AnalyzeReflection(context.Background(), Input{Turns: []Turn{{Stage: "facts", AnswerText: text}}})
		if err != nil || hasFacet(reflection, "slowing_reactions") || hasFacet(reflection, "listening") {
			t.Fatalf("unsupported observation for %q: %+v, %v", text, reflection, err)
		}
	}
}

type reflectionCompleter struct {
	responses []Reflection
	err       error
	calls     int
	task      string
	input     Input
	schema    map[string]any
}

func (c *reflectionCompleter) complete(_ context.Context, name string, schema map[string]any, task string, in Input, dst any) error {
	c.calls++
	if name != "conversation_reflection" {
		return errors.New("unexpected task name")
	}
	c.task, c.input, c.schema = task, in, schema
	if c.err != nil {
		return c.err
	}
	response := c.responses[min(c.calls-1, len(c.responses)-1)]
	data, err := json.Marshal(response)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, dst)
}

func TestReflectionHostedPromptUsesBoundedOwnContext(t *testing.T) {
	in := Input{Profile: Profile{TraitLevels: map[string]string{"a": "high"}}, Turns: []Turn{{Stage: "facts", AnswerText: "My private answer"}}}
	want, _ := NewMock().AnalyzeReflection(context.Background(), in)
	client := &reflectionCompleter{responses: []Reflection{want}}
	got, err := newGenerator(client).AnalyzeReflection(context.Background(), in)
	if err != nil || got.Summary != want.Summary || client.calls != 1 {
		t.Fatalf("got=%+v err=%v calls=%d", got, err, client.calls)
	}
	if client.input.Turns[0].AnswerText != in.Turns[0].AnswerText || client.input.Profile.TraitLevels["a"] != "high" {
		t.Fatal("lost own history or optional questionnaire context")
	}
	for _, needed := range []string{"own answers", "A pause is not unwillingness", "Do not give scores", "not proof of behavior", "do not invent"} {
		if !strings.Contains(client.task, needed) {
			t.Fatalf("missing prompt constraint %q", needed)
		}
	}
	if client.schema["additionalProperties"] != false {
		t.Fatal("reflection schema is not closed")
	}
}

func TestReflectionRetriesInvalidContentButPropagatesProviderFailure(t *testing.T) {
	valid, _ := NewMock().AnalyzeReflection(context.Background(), Input{})
	invalid := valid
	invalid.Summary = strings.Repeat("long ", 36)
	client := &reflectionCompleter{responses: []Reflection{invalid, valid}}
	if got, err := newGenerator(client).AnalyzeReflection(context.Background(), Input{}); err != nil || reflectionProblem(got) != "" || client.calls != 2 {
		t.Fatal(got, err, client.calls)
	}
	if !strings.Contains(client.task, "previous reflection failed validation") {
		t.Fatal("repair instruction missing")
	}
	client = &reflectionCompleter{responses: []Reflection{invalid}}
	if got, err := newGenerator(client).AnalyzeReflection(context.Background(), Input{}); err != nil || reflectionProblem(got) != "" || client.calls != 2 {
		t.Fatal("invalid repeated content did not fall back", got, err)
	}
	wantErr := errors.New("provider unavailable")
	client = &reflectionCompleter{err: wantErr}
	if _, err := newGenerator(client).AnalyzeReflection(context.Background(), Input{}); !errors.Is(err, wantErr) || client.calls != 1 {
		t.Fatal("provider failure should remain an error", err)
	}
}

func TestReflectionRejectsDuplicatesScoresAndFixedLabels(t *testing.T) {
	valid, _ := NewMock().AnalyzeReflection(context.Background(), Input{})
	for _, label := range []string{"Aggressiveness", "A good listener", "Avoidant", "Score 80", "Mostly 50% ready"} {
		candidate := valid
		candidate.Facets = append([]ReflectionFacet(nil), valid.Facets...)
		candidate.Facets[0].Label = label
		if reflectionProblem(candidate) == "" {
			t.Fatalf("accepted unsupported fixed label %q", label)
		}
	}
	valid.Facets[1].ID = valid.Facets[0].ID
	if reflectionProblem(valid) == "" {
		t.Fatal("accepted duplicate ids")
	}
}

func hasFacet(reflection Reflection, id string) bool {
	for _, facet := range reflection.Facets {
		if facet.ID == id {
			return true
		}
	}
	return false
}
