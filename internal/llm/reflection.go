package llm

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

// ReflectionAnalyzer is optional so existing generation clients can keep their
// question/result contract. Reflections describe this conversation, not traits
// measured on a psychological scale.
type ReflectionAnalyzer interface {
	AnalyzeReflection(context.Context, Input) (Reflection, error)
}

type Reflection struct {
	Summary string            `json:"summary"`
	Facets  []ReflectionFacet `json:"facets"`
}

type ReflectionFacet struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Kind        string `json:"kind"`
	Explanation string `json:"explanation"`
	Practice    string `json:"practice"`
}

var reflectionSchema = objectSchema(map[string]any{
	"summary": map[string]any{"type": "string"},
	"facets": map[string]any{
		// Anthropic structured outputs reject maxItems and minItems > 1.
		// Keep the 3–5 bound in the prompt and reflectionProblem instead.
		"type": "array", "description": "Three to five distinct conversation themes.",
		"items": objectSchema(map[string]any{
			"id":          map[string]any{"type": "string"},
			"label":       map[string]any{"type": "string"},
			"kind":        map[string]any{"type": "string", "enum": []string{"strength", "growth"}},
			"explanation": map[string]any{"type": "string"},
			"practice":    map[string]any{"type": "string"},
		}),
	},
})

const reflectionTask = `Create a private, tentative reflection about this person's approach to this particular conversation.
Use only their own answers and their optional questionnaire context. A partner's reported actions are not evidence of this person's behavior.
Return 3 to 5 distinct facets: supported strengths and specific areas to explore. Each facet has a stable lowercase underscore id, a short label, kind strength or growth, explanation, and a practical next step.
Ground every explanation in the supplied answers without quoting raw text. If evidence is missing, describe what could be explored; do not invent a strength or a problem.
Listening is a strength only if the person actually describes listening. A pause is not unwillingness to talk. Reactivity requires the person's own account of their own reaction, not their partner's.
Questionnaire traits are optional background, not proof of behavior. Do not describe the partner's personality or private experience.
Do not use diagnoses, fixed labels such as aggressive, avoidant, bad listener, or not willing to talk. Do not give scores, percentages, rankings, or claim scientific measurement.
Prefer four concise facets. For this reflection task use at most 35 words / 300 characters in summary, 5 words / 60 characters in each label, 45 words / 400 characters in each explanation, and 30 words / 260 characters in each practice. Aim for one short sentence in each explanation and practice.
Use respectful, non-graphic paraphrases even when the person's answers contain explicit language. Avoid fixed personality labels in every field, including explanations, not just labels. Do not use numerical digits anywhere in the prose; write a suggested duration in words. Do not mention scores, percentages, or diagnoses, even in disclaimers.
Explain that these are themes to reflect on from this conversation, not a personality assessment. Write in English. The application withholds practical next steps until full access; explanations remain visible in the preview. Do not include purchase advice.`

const (
	reflectionGenerationTimeout = 22 * time.Second
	reflectionResponseReserve   = time.Second
	reflectionRetryMinimum      = 12 * time.Second
)

func (g *Generator) AnalyzeReflection(ctx context.Context, in Input) (Reflection, error) {
	if err := ctx.Err(); err != nil {
		return Reflection{}, err
	}
	// A reflection is larger than a question. Leave time to return the response
	// and never spend the entire request deadline repairing invalid model text.
	budget := reflectionGenerationTimeout
	if deadline, ok := ctx.Deadline(); ok {
		budget = min(budget, time.Until(deadline)-reflectionResponseReserve)
	}
	if budget <= 0 {
		return g.basicReflection(ctx, in, "insufficient_time")
	}
	generationCtx, cancel := context.WithTimeout(ctx, budget)
	defer cancel()
	previousProblem := ""
	for attempt := 0; attempt < 2; attempt++ {
		if attempt > 0 {
			deadline, _ := generationCtx.Deadline()
			if time.Until(deadline) < reflectionRetryMinimum {
				return g.basicReflection(ctx, in, "insufficient_retry_time")
			}
		}
		task := reflectionTask
		if attempt > 0 {
			task += "\nThe previous reflection failed validation: " + previousProblem + ". Rewrite the affected field using neutral language. Return 3 to 5 distinct concise facets with all fields filled, no fixed labels or scores, and respect all word and character limits."
		}
		var reflection Reflection
		if err := g.c.complete(generationCtx, "conversation_reflection", reflectionSchema, task, in, &reflection); err != nil {
			if ctx.Err() != nil {
				return Reflection{}, ctx.Err()
			}
			if errors.Is(err, context.DeadlineExceeded) || errors.Is(generationCtx.Err(), context.DeadlineExceeded) {
				return g.basicReflection(ctx, in, "generation_timeout")
			}
			return Reflection{}, err
		}
		if ctx.Err() != nil {
			return Reflection{}, ctx.Err()
		}
		if problem := reflectionProblem(reflection); problem == "" {
			return reflection, nil
		} else {
			previousProblem = problem
			slog.Warn("generated reflection rejected", "attempt", attempt+1, "reason", problem)
		}
	}
	return g.basicReflection(ctx, in, "invalid_generated_content")
}

func (g *Generator) basicReflection(ctx context.Context, in Input, reason string) (Reflection, error) {
	reflection, err := g.fallback.AnalyzeReflection(ctx, in)
	if err != nil {
		return Reflection{}, err
	}
	// Do not present the bounded offline fallback as a successful model analysis.
	reflection.Summary = "This basic reflection uses your answers. A more detailed reflection could not be prepared this time."
	slog.Warn("using basic conversation reflection", "reason_code", reason)
	return reflection, nil
}

var reflectionID = regexp.MustCompile(`^[a-z][a-z0-9_]{1,39}$`)

func reflectionProblem(reflection Reflection) string {
	if len(reflection.Facets) < 3 || len(reflection.Facets) > 5 {
		return "need three to five facets"
	}
	if problem := reflectionTextProblem(reflection.Summary, 35, 300); problem != "" {
		return "summary: " + problem
	}
	ids := make(map[string]bool, len(reflection.Facets))
	labels := make(map[string]bool, len(reflection.Facets))
	for i, facet := range reflection.Facets {
		if !reflectionID.MatchString(facet.ID) || ids[facet.ID] {
			return "invalid or duplicate facet id"
		}
		label := strings.ToLower(strings.TrimSpace(facet.Label))
		if labels[label] {
			return "duplicate facet label"
		}
		if problem := reflectionTextProblem(facet.Label, 5, 60); problem != "" {
			return fmt.Sprintf("facet %d label: %s", i+1, problem)
		}
		if facet.Kind != "strength" && facet.Kind != "growth" {
			return "invalid facet kind"
		}
		if problem := reflectionTextProblem(facet.Explanation, 45, 400); problem != "" {
			return fmt.Sprintf("facet %d explanation: %s", i+1, problem)
		}
		if problem := reflectionTextProblem(facet.Practice, 30, 260); problem != "" {
			return fmt.Sprintf("facet %d practice: %s", i+1, problem)
		}
		ids[facet.ID], labels[label] = true, true
	}
	return ""
}

// Reasons contain only field names and fixed validation codes, never model text.
func reflectionTextProblem(value string, maxWords, maxCharacters int) string {
	switch {
	case strings.TrimSpace(value) == "":
		return "empty text"
	case words(value) > maxWords:
		return "word limit exceeded"
	case utf8.RuneCountInString(value) > maxCharacters:
		return "character limit exceeded"
	case hasForbidden(value):
		return "prohibited language"
	}
	lower := strings.ToLower(value)
	for _, term := range []string{"aggress", "narciss", "borderline", "avoidant", "personality disorder", "bad listener", "good listener", "not willing to talk", "score", "percent", "%"} {
		if strings.Contains(lower, term) {
			return "fixed label or scoring language"
		}
	}
	if strings.ContainsAny(value, "0123456789") {
		return "numerical digits in prose"
	}
	return ""
}

// The offline reflection makes only narrow observations supported by the
// person's own account. Unanswered themes remain questions to explore.
func (*Mock) AnalyzeReflection(ctx context.Context, in Input) (Reflection, error) {
	if err := ctx.Err(); err != nil {
		return Reflection{}, err
	}
	answers := make(map[string]string, len(in.Turns))
	for _, turn := range in.Turns {
		answers[turn.Stage] = strings.ToLower(strings.TrimSpace(turn.AnswerText))
	}
	selfReport := reflectionSelfReport(answers["facts"]) + " " + reflectionSelfReport(answers["feelings"]) + " " + reflectionSelfReport(answers["needs"])
	facets := []ReflectionFacet{}
	add := func(id, label, kind, explanation, practice string) {
		facets = append(facets, ReflectionFacet{ID: id, Label: label, Kind: kind, Explanation: explanation, Practice: practice})
	}
	if answers["facts"] != "" {
		add("looking_back", "Looking at what happened", "strength", "You have put your experience into words. That gives you something concrete to reflect on before the next conversation.", "Start with one event you both could observe, then explain how it affected you.")
	} else {
		add("finding_a_start", "Finding a starting point", "growth", "There is not enough detail yet to describe how this conversation unfolded. Begin with the event that mattered most to you.", "Name one specific moment without guessing what your partner intended.")
	}
	if selfReaction.MatchString(selfReport) {
		add("slowing_reactions", "Slowing the reaction", "growth", "You describe raising your voice or reacting quickly. That moment may be worth revisiting without treating it as a fixed part of who you are.", "Notice the earliest sign of tension and ask for a pause before continuing.")
	} else if selfPause.MatchString(selfReport) || in.Profile.ConflictStyle == "need_space" || in.Profile.RepairNeed == "alone_time" {
		add("making_space", "Making space to settle", "strength", "Your answers suggest that space can help you prepare. A pause can support a conversation when you also agree how to return to it.", "Ask for the time you need and agree on a clear moment to reconnect.")
	} else if answers["feelings"] != "" {
		add("naming_feelings", "Naming your feelings", "strength", "You have named how this situation felt for you. Keeping that experience separate from a judgment can make your opening clearer.", "Try one sentence beginning with what you felt in that moment.")
	}
	if answers["needs"] != "" {
		add("naming_needs", "Making needs specific", "strength", "You have started identifying what would have helped. A concrete request gives your partner something clearer to respond to.", "Turn the need you named into one small request that leaves room for their answer.")
	} else {
		add("exploring_needs", "Finding what would help", "growth", "These answers do not yet make clear what would have helped you. That is a useful next question, rather than a conclusion about your character.", "Ask yourself what support or change you would like in the next similar moment.")
	}
	if selfListening.MatchString(selfReport) {
		add("listening", "Making room to listen", "strength", "You describe trying to listen or check your understanding. That is a useful action to build on while also making room for your own experience.", "Let them finish, reflect back what you heard, and ask whether you understood.")
	} else if len(facets) < 5 {
		add("checking_perspective", "Checking another perspective", "growth", "This account contains your experience, not your partner's. Their perspective is still something to ask about, rather than assume.", "Ask what the same moment felt like for them and listen before responding.")
	}
	return Reflection{Summary: "These are themes to reflect on from the answers you shared about this conversation, not a personality assessment or a measure of either partner.", Facets: facets}, nil
}

var selfReaction = regexp.MustCompile(`(?i)\b(?:i (?:yelled|shouted|snapped|interrupted)|i raised my voice|i kept interrupting)\b|я (?:кричал|кричала|накричал|накричала|перебил|перебила|повысил|повысила)`)
var selfPause = regexp.MustCompile(`(?i)\b(?:i (?:needed|need|asked for|took|wanted) (?:a |some )?(?:pause|space|time alone|break))\b|мне (?:нужна|нужно|нужен) (?:пауза|побыть|перерыв)|я (?:попросил|попросила) пауз`)
var selfListening = regexp.MustCompile(`(?i)\b(?:i (?:listened|tried to listen) to (?:my partner|them|her|him)|i asked (?:my partner|them|her|him) how (?:they|she|he) felt|i let (?:them|her|him|my partner) finish)\b|я (?:выслушал|выслушала|попытался выслушать|попыталась выслушать) (?:партнера|партнёра|её|его)`)

var uncertainSelfReport = regexp.MustCompile(`(?i)\b(?:if|would|could|might|maybe|suppose|pretend|example|said|says|told|wrote|never|not|didn't|didn’t|don't|don’t|without)\b|если|сказал|сказала|сказали|цитат|например|никогда|не `)

// Template observations should prefer missing evidence over attributing a
// quoted, hypothetical, negated, or reported statement to the owner.
func reflectionSelfReport(answer string) string {
	var clean strings.Builder
	var closingQuote rune
	for _, r := range answer {
		if closingQuote != 0 {
			if r == closingQuote {
				closingQuote = 0
				clean.WriteByte(' ')
			}
			continue
		}
		switch r {
		case '"':
			closingQuote = '"'
		case '“':
			closingQuote = '”'
		case '«':
			closingQuote = '»'
		default:
			clean.WriteRune(r)
		}
	}
	var direct []string
	for _, sentence := range strings.FieldsFunc(clean.String(), func(r rune) bool { return r == '.' || r == '!' || r == '?' || r == ';' || r == '\n' }) {
		if !uncertainSelfReport.MatchString(sentence) {
			direct = append(direct, sentence)
		}
	}
	return strings.Join(direct, " ")
}
