package llm

import (
	"regexp"
	"strings"
	"unicode"
)

const respectfulLanguagePrompt = `Use respectful, neutral language in EVERY generated field, including questions,
answer cards, summaries, opening lines, reflection labels, explanations, and advice.
Never repeat profanity, slurs, insults, degrading descriptions, or graphic sexual or
bodily details from the person's answers, even in a quotation or when asked to do so.
Preserve the meaning in a brief, non-graphic paraphrase. For an explicit incident,
focus on its impact, consent, boundaries, and taking responsibility where relevant;
do not describe the act again. Refer to hurtful words instead of quoting an insult.
Do not label either person as disgusting, stupid, crazy, or worthless. Do not turn
humiliation, coercion, or a boundary violation into a harmless misunderstanding,
excuse it as good intentions, or press the other person to reconnect. Do not invent
a boundary violation if it was not described. Sensitive context is still valid
context: ask a useful, calm question rather than refusing or moralizing.`

// This is a backstop to the semantic instruction above, not a safety classifier.
// It checks generated prose only: users may describe a difficult incident in
// their own words. Full word boundaries avoid rejecting words such as "peers",
// "assessment", "class", "Dickens", "cocktail", and "страхуй".
var disrespectfulLanguage = regexp.MustCompile(`(?i)(?:^|[^\pL\pN])(?:` +
	`(?:mother)?fuck(?:s|ed|er|ers|ing)?|f[\*#@]+c?k(?:ing|ed)?|` +
	`(?:bull|horse)?shit(?:s|ty|ting|head|heads)?|sh[\*#@]+t|` +
	`piss(?:es|ed|ing)?|pee(?:s|d|ing)?|crap(?:s|py|ped|ping)?|` +
	`ass(?:es|hole|holes)?|bitch(?:es|y|ing)?|bastard(?:s)?|cunt(?:s)?|twat(?:s)?|` +
	`dick(?:s)?|cock(?:s)?|slut(?:s|ty)?|whore(?:s)?|` +
	`nigg(?:er|ers|a|as)|fagg?ot(?:s)?|retard(?:s|ed)?|` +
	`idiot(?:s|ic)?|moron(?:s|ic)?|scumbag(?:s)?|` +
	`stupid|disgusting|worthless|crazy|dumb|` +
	`urinat(?:e|es|ed|ing|ion)|defecat(?:e|es|ed|ing|ion)|feces|faeces|` +
	`semen|cum(?:s|ming)?|ejaculat(?:e|es|ed|ing|ion)|masturbat(?:e|es|ed|ing|ion)|` +
	`penis(?:es)?|vagina(?:s)?|genitals|blowjobs?|handjobs?|` +
	`(?:бля|блядь|блять|блядский|блядская|блядские)|` +
	`(?:сука|суки|сукой|суку|сучка|сучки|сучку|сучкой)|` +
	`(?:на|по)?ху(?:й|я|ю|ем|ём|е)|ху[её]в[\pL]*|хуйн[\pL]*|` +
	`(?:[её]б|за[её]б|на[её]б|вы[её]б|от[её]б|у[её]б|про[её]б)[\pL]*|` +
	`пизд[\pL]*|говн[\pL]*|дерьм[\pL]*|` +
	`(?:по|на|обо)?ссал[\pL]*|(?:по|на|обо)?ссат[\pL]*|(?:на|обо)?сра(?:л[\pL]*|ть)|` +
	`(?:мочился|мочилась|помочился|помочилась|пописал|пописала)|` +
	`(?:мудак|мудаки|мудака|мудаком|мразь|мразью|мрази)|` +
	`(?:идиот|идиотка|идиоты|дебил|дебилка|дебилы)` +
	`)(?:$|[^\pL\pN])`)

var shamingLanguage = regexp.MustCompile(`(?i)(?:^|[^\pL\pN])(?:` +
	`(?:you|they|he|she|your partner) (?:are|is|were|was) (?:so |just |really )?(?:disgusting|stupid|crazy|worthless)|` +
	`(?:ты|вы|он|она) (?:отвратительн[\pL]*|туп[\pL]*|ничтожн[\pL]*)` +
	`)(?:$|[^\pL\pN])`)

func hasDisrespectfulLanguage(text string) bool {
	// Strip invisible formatting so a model cannot accidentally bypass the
	// guard by inserting zero-width characters inside a prohibited word.
	plain := strings.Map(func(r rune) rune {
		if unicode.Is(unicode.Cf, r) {
			return -1
		}
		return r
	}, text)
	return disrespectfulLanguage.MatchString(plain) || shamingLanguage.MatchString(plain)
}
