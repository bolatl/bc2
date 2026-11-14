package personality

import "testing"

func TestScorePublishedReverseKey(t *testing.T) {
	// Endorse every positive-keyed item and reject every negative-keyed item.
	answers := []int{5, 5, 5, 5, 5, 1, 1, 1, 1, 1, 5, 5, 5, 5, 1, 1, 1, 1, 1, 1}
	result, err := Score(answers)
	if err != nil {
		t.Fatal(err)
	}
	for name, got := range map[string]TraitResult{"e": result.Traits.E, "a": result.Traits.A, "c": result.Traits.C, "n": result.Traits.N, "i": result.Traits.I} {
		if got.Score != 20 || got.Level != "high" {
			t.Errorf("%s = %+v; want 20/high", name, got)
		}
	}
	if len(result.Strengths) != 3 || len(result.Tips) != 2 {
		t.Fatal("report must have three strengths and two tips")
	}
	for i := range answers {
		answers[i] = 6 - answers[i]
	}
	result, err = Score(answers)
	if err != nil || result.Traits.I.Score != 4 || result.Traits.N.Score != 4 || result.Traits.E.Level != "low" {
		t.Fatalf("reverse profile: %+v, %v", result, err)
	}
}

func TestScoreRejectsIncompleteAndOutOfRangeAnswers(t *testing.T) {
	for _, count := range []int{0, 19, 21} {
		if _, err := Score(make([]int, count)); err == nil {
			t.Errorf("accepted %d answers", count)
		}
	}
	for _, bad := range []int{-1, 0, 6} {
		answers := make([]int, 20)
		for i := range answers {
			answers[i] = 3
		}
		answers[8] = bad
		if _, err := Score(answers); err == nil {
			t.Errorf("accepted answer %d", bad)
		}
	}
}

func TestLevelBoundariesAndAllNeutral(t *testing.T) {
	for _, tt := range []struct {
		score int
		level string
	}{{4, "low"}, {9, "low"}, {10, "mid"}, {14, "mid"}, {15, "high"}, {20, "high"}} {
		if got := trait(tt.score).Level; got != tt.level {
			t.Errorf("score %d = %s; want %s", tt.score, got, tt.level)
		}
	}
	answers := make([]int, 20)
	for i := range answers {
		answers[i] = 3
	}
	got, err := Score(answers)
	if err != nil || got.Traits.E.Score != 12 || got.Traits.I.Score != 12 {
		t.Fatalf("neutral profile: %+v, %v", got, err)
	}
}
