package llm

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

type languageSequenceCompleter struct {
	responses []any
	tasks     []string
}

func (c *languageSequenceCompleter) complete(_ context.Context, _ string, _ map[string]any, task string, _ Input, dst any) error {
	response := c.responses[min(len(c.tasks), len(c.responses)-1)]
	c.tasks = append(c.tasks, task)
	data, err := json.Marshal(response)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, dst)
}

func TestGeneratedLanguageGuardRejectsCrudeDetailsWithoutSubstringMatches(t *testing.T) {
	for _, text := range []string{
		"When she got angry after you peed on her, what was hardest for you?",
		"How did pissing on her affect trust?",
		"How did urinating on your partner affect the moment?",
		"I called him a fucking idiot.",
		"You are disgusting.",
		"She is worthless.",
		"You're stupid.",
		"You’re stupid.",
		"She's disgusting.",
		"She’s disgusting.",
		"What made you feel stupid in that moment?",
		"Why did she call you crazy?",
		"I felt dumb.",
		"Я обозвал её сукой.",
		"Почему ты поссал на неё?",
		"Я нахуй устал от этого.",
		"Мне всё заебало.",
		"Почему ты её обматерил: «блядь»?",
		"fu\u200bck",
	} {
		if !hasForbidden(text) {
			t.Errorf("accepted generated language %q", text)
		}
	}
	for _, text := range []string{
		"What would help you acknowledge the impact of that moment?",
		"What boundary did your partner ask you to respect?",
		"How could you talk about intimacy with care?",
		"I felt afraid after being threatened.",
		"Could you give them the space they requested?",
		"Our peers discussed a class assessment over cocktails.",
		"Reading Dickens helped me decompress.",
		"What made you feel embarrassed in that moment?",
		"I felt upset and hurt.",
		"You mentioned exercising with dumbbells.",
		"Я хочу обсудить страх и услышать твои потребности.",
		"Мы решили подстраховаться.",
	} {
		if hasForbidden(text) {
			t.Errorf("rejected neutral generated language %q", text)
		}
	}
}

func TestQuestionRewritesCrudeLanguageBeforeReturning(t *testing.T) {
	input := Input{Stage: "feelings", Turns: []Turn{{Stage: "facts", AnswerSource: "free_text", AnswerText: "I peed on her and she got angry."}}}
	unsafe := Question{"When she got angry after you peed on her, what was hardest for you?", "Seeing her upset", "Not knowing what to say"}
	safe := Question{"What felt hardest about the impact of that moment?", "Recognizing the hurt I caused", "Not knowing how to acknowledge it"}
	provider := &languageSequenceCompleter{responses: []any{unsafe, safe}}
	got, err := newGenerator(provider).NextTurn(context.Background(), input)
	if err != nil || got != safe || len(provider.tasks) != 2 {
		t.Fatalf("crude output was not rewritten: got=%+v err=%v calls=%d", got, err, len(provider.tasks))
	}
	if !strings.Contains(provider.tasks[1], "respectful, neutral language") {
		t.Fatal("retry did not request a respectful rewrite")
	}
}

func TestRepeatedCrudeQuestionsAndCardsUseSafeFallback(t *testing.T) {
	input := Input{Stage: "feelings", Turns: []Turn{{Stage: "facts", AnswerText: "He called me a fucking bitch while we discussed the dishes."}}}
	for _, unsafe := range []Question{
		{"How did being called a bitch feel?", "I felt hurt", "I felt angry"},
		{"What felt hardest about that conversation?", "His shitty attitude", "I felt upset"},
		{"What felt hardest about that conversation?", "I felt upset", "He was a fucking idiot"},
	} {
		provider := &languageSequenceCompleter{responses: []any{unsafe}}
		got, err := newGenerator(provider).NextTurn(context.Background(), input)
		if err != nil || questionProblem(got) != "" || got == unsafe || len(provider.tasks) != 2 {
			t.Fatalf("unsafe fallback: %+v err=%v calls=%d", got, err, len(provider.tasks))
		}
		if !strings.Contains(got.AgentQuestion, "dishes") {
			t.Fatal("fallback lost the neutral situational context")
		}
	}
}

func TestResultsAndReflectionsRejectCrudeLanguageInEveryDisplayedField(t *testing.T) {
	input := Input{Turns: []Turn{{Stage: "facts", AnswerText: "We argued about the dishes."}}}
	safeResult, _ := NewMock().FinalResult(context.Background(), input)
	for _, field := range []string{"felt", "need", "opening", "rule"} {
		unsafe := safeResult
		unsafe.SharedRules = append([]string(nil), safeResult.SharedRules...)
		switch field {
		case "felt":
			unsafe.FeltText = "I felt like a fucking idiot."
		case "need":
			unsafe.NeedText = "I needed her to stop being a bitch."
		case "opening":
			unsafe.OpeningLine = "I was an asshole."
		case "rule":
			unsafe.SharedRules[0] = "Stop acting like an idiot."
		}
		provider := &languageSequenceCompleter{responses: []any{unsafe, safeResult}}
		got, err := newGenerator(provider).FinalResult(context.Background(), input)
		if err != nil || resultProblem(got) != "" || len(provider.tasks) != 2 {
			t.Fatalf("%s result not rewritten: %+v err=%v calls=%d", field, got, err, len(provider.tasks))
		}
	}
	safeReflection, _ := NewMock().AnalyzeReflection(context.Background(), input)
	for _, field := range []string{"summary", "label", "explanation", "practice"} {
		unsafe := safeReflection
		unsafe.Facets = append([]ReflectionFacet(nil), safeReflection.Facets...)
		switch field {
		case "summary":
			unsafe.Summary = "You felt like an idiot."
		case "label":
			unsafe.Facets[0].Label = "Being an asshole"
		case "explanation":
			unsafe.Facets[0].Explanation = "Your partner called you a bitch."
		case "practice":
			unsafe.Facets[0].Practice = "Explain why you peed on her."
		}
		provider := &languageSequenceCompleter{responses: []any{unsafe, safeReflection}}
		got, err := newGenerator(provider).AnalyzeReflection(context.Background(), input)
		if err != nil || reflectionProblem(got) != "" || len(provider.tasks) != 2 {
			t.Fatalf("%s reflection not rewritten: %+v err=%v calls=%d", field, got, err, len(provider.tasks))
		}
	}
}

func TestMockNeverEchoesCrudeInput(t *testing.T) {
	input := Input{Turns: []Turn{
		{Stage: "facts", AnswerText: "I peed on her and she called me a fucking idiot."},
		{Stage: "feelings", AnswerText: "I felt like shit."},
		{Stage: "needs", AnswerText: "I needed to stop being an asshole."},
	}}
	client := NewMock()
	for _, stage := range []string{"facts", "feelings", "needs", "partner_view", "rehearsal"} {
		input.Stage = stage
		question, err := client.NextTurn(context.Background(), input)
		if err != nil || hasForbidden(question.AgentQuestion, question.OptionLeft, question.OptionRight) {
			t.Fatalf("mock echoed crude input at %s: %+v err=%v", stage, question, err)
		}
	}
	result, err := client.FinalResult(context.Background(), input)
	if err != nil || resultProblem(result) != "" {
		t.Fatalf("mock result echoed crude input: %+v err=%v", result, err)
	}
	reflection, err := client.AnalyzeReflection(context.Background(), input)
	if err != nil || reflectionProblem(reflection) != "" {
		t.Fatalf("mock reflection echoed crude input: %+v err=%v", reflection, err)
	}
}
