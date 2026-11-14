// Package personality scores the Mini-IPIP without making an LLM request.
package personality

import "fmt"

// ScoringSource is the primary item and reverse-scoring key, checked 2026-11-15.
const ScoringSource = "https://www.ipip.ori.org/MiniIPIPKey.htm"

type TraitResult struct {
	Score int    `json:"score"`
	Level string `json:"level"`
}

type Traits struct {
	E TraitResult `json:"e"`
	A TraitResult `json:"a"`
	C TraitResult `json:"c"`
	N TraitResult `json:"n"`
	I TraitResult `json:"i"`
}

type Result struct {
	Traits    Traits   `json:"traits"`
	Strengths []string `json:"strengths"`
	Tips      []string `json:"tips"`
}

// Score uses the question ordering in LoveLab_BACKEND_PROMPT.md. Level cutoffs
// are product display bands, not population norms or clinical thresholds.
func Score(answers []int) (Result, error) {
	if len(answers) != 20 {
		return Result{}, fmt.Errorf("exactly 20 answers are required")
	}
	reversed := [20]bool{false, false, false, false, false, true, true, true, true, true, false, false, false, false, true, true, true, true, true, true}
	var scores [5]int
	for index, answer := range answers {
		if answer < 1 || answer > 5 {
			return Result{}, fmt.Errorf("answer %d must be between 1 and 5", index+1)
		}
		if reversed[index] {
			answer = 6 - answer
		}
		scores[index%5] += answer
	}
	traits := Traits{E: trait(scores[0]), A: trait(scores[1]), C: trait(scores[2]), N: trait(scores[3]), I: trait(scores[4])}
	strengths := []string{
		choose(traits.A.Level, "You can state your own view clearly and make room to hear another.", "You can balance your own needs with attention to another person.", "You notice other people's feelings and can bring care to a conversation."),
		choose(traits.C.Level, "You can stay flexible when a conversation takes an unexpected turn.", "You can combine a practical next step with room to adjust.", "You can turn a shared intention into a clear, practical next step."),
		choose(traits.I.Level, "You can keep a conversation grounded in clear, everyday examples.", "You can use both familiar examples and new perspectives.", "You can imagine another perspective and try a different way to begin."),
	}
	tips := []string{
		choose(traits.N.Level, "When upset, check how your partner is feeling before moving to a plan.", "When upset, name what you feel before choosing the next step.", "When upset, give yourself a short pause before choosing your first words."),
		choose(traits.E.Level, "When upset, try writing one sentence before speaking when you both feel ready.", "When upset, choose a message or a conversation based on what feels manageable.", "When upset, take one breath and invite a reply after your first sentence."),
	}
	return Result{Traits: traits, Strengths: strengths, Tips: tips}, nil
}

func trait(score int) TraitResult {
	level := "mid"
	if score <= 9 {
		level = "low"
	} else if score >= 15 {
		level = "high"
	}
	return TraitResult{Score: score, Level: level}
}

func choose(level, low, mid, high string) string {
	switch level {
	case "low":
		return low
	case "high":
		return high
	default:
		return mid
	}
}
