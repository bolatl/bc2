// Package safety supplies a deterministic pre-LLM stop gate for the MVP.
// This conservative English/Russian phrase gate is not a comprehensive risk
// assessment: euphemisms, other languages and unseen wording can be missed;
// negated or quoted crisis phrases can stop a session unnecessarily.
package safety

import (
	"strings"
	"unicode"
)

type Hotline struct {
	Name  string `json:"name"`
	Phone string `json:"phone"`
}

// Hotlines returns US resources for the US-targeted MVP, not geolocation advice.
// 988 was verified with the connected hotline lookup on 2026-11-15; the other
// resources are explicitly required by the supplied backend specification.
func Hotlines() []Hotline {
	return []Hotline{
		{Name: "US emergency services", Phone: "911"},
		{Name: "988 Suicide & Crisis Lifeline", Phone: "988"},
		{Name: "National Domestic Violence Hotline", Phone: "1-800-799-7233"},
	}
}

var stopPhrases = []string{
	"kill myself", "killing myself", "end my life", "ending my life", "take my own life", "want to die", "wish i was dead", "wish i were dead", "better off dead", "suicide", "suicidal", "hurt myself", "hurting myself", "harm myself", "harming myself", "self harm", "cut myself", "cutting myself", "overdose", "took too many pills",
	"he hit me", "she hit me", "they hit me", "partner hit me", "husband hit me", "wife hit me", "boyfriend hit me", "girlfriend hit me", "he hits me", "she hits me", "partner hits me", "hitting me", "beat me", "beats me", "beating me", "choked me", "chokes me", "choking me", "strangled me", "strangling me", "slapped me", "slaps me", "punched me", "punches me", "pushed me", "threatened me", "threatens me", "threatening me", "threatened to kill", "threatens to kill", "domestic violence", "violence at home", "physical abuse", "physically abusive", "physically hurt", "sexual assault", "raped me", "rape me", "forced me to have sex", "afraid for my life", "not safe at home", "unsafe at home", "i am in danger", "i m in danger", "locked me in", "won t let me leave", "will not let me leave", "kill him", "kill her", "kill them", "hurt my partner",
	"убить себя", "убью себя", "покончить с собой", "покончу с собой", "хочу умереть", "не хочу жить", "самоубий", "суицид", "причинить себе вред", "порезать себя", "режу себя", "вскрыть вены", "выпила таблетки", "выпил таблетки", "он меня бьет", "она меня бьет", "бьет меня", "бил меня", "била меня", "избил", "избила", "избивает", "ударил меня", "ударила меня", "меня ударил", "меня ударила", "душит меня", "душил меня", "меня душит", "меня душил", "угрожает убить", "угрожал убить", "угрожала убить", "домашнее насилие", "боюсь за свою жизнь", "изнасил", "не выпускает из дома", "убью его", "убью ее",
}

// Check reports whether text must take the private safety-stop route.
// Call before every LLM method, including classification and final summaries.
func Check(text string) bool {
	normalized := normalize(text)
	for _, phrase := range stopPhrases {
		if strings.Contains(normalized, phrase) {
			return true
		}
	}
	return false
}

func CheckAll(texts ...string) bool {
	for _, text := range texts {
		if Check(text) {
			return true
		}
	}
	return false
}

func normalize(text string) string {
	text = strings.Map(func(r rune) rune {
		if unicode.Is(unicode.Cf, r) {
			return -1
		}
		if r == 'ё' || r == 'Ё' {
			return 'е'
		}
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			return unicode.ToLower(r)
		}
		return ' '
	}, text)
	return strings.Join(strings.Fields(text), " ")
}
