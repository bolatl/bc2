package safety

import "testing"

func TestCrisisGate(t *testing.T) {
	for _, input := range []string{
		"I want to kill myself", "I want to end my life", "I feel suicidal.",
		"She hit me last night", "He is hitting me", "My partner threatened to kill me", "My husband hit me",
		"I’m in danger", "He won't let me leave", "I want to hurt my partner",
		"Он меня бьёт", "Она ударила меня", "Я хочу умереть", "Он угрожает убить меня",
		"I want to KILL\nmyself", "I want to ki\u200bll myself",
	} {
		if !Check(input) {
			t.Errorf("missed crisis phrase %q", input)
		}
	}
	for _, input := range []string{"We had a fight about chores", "I feel sad and unheard", "I need a little space", "The phone battery is dead", "Мы поссорились из-за уборки", "I could kill for a coffee"} {
		if Check(input) {
			t.Errorf("stopped ordinary input %q", input)
		}
	}
}

func TestHotlineCopiesAreIndependent(t *testing.T) {
	a := Hotlines()
	a[0].Phone = "changed"
	if Hotlines()[0].Phone == "changed" {
		t.Fatal("caller mutated global resources")
	}
	if !CheckAll("ordinary conversation", "I want to die") {
		t.Fatal("did not scan every text")
	}
}
