package service

import (
	"lovelab/internal/model"
	"lovelab/internal/personality"
)

func (a *App) SubmitPersonality(actor model.Actor, answers []int) (model.PersonalityProfile, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if _, err := a.couple(actor); err != nil {
		return model.PersonalityProfile{}, err
	}
	result, err := personality.Score(answers)
	if err != nil {
		return model.PersonalityProfile{}, invalid("answers must contain exactly 20 integers between 1 and 5.")
	}
	cv := func(t personality.TraitResult) model.TraitResult {
		return model.TraitResult{Score: t.Score, Level: t.Level}
	}
	p := model.PersonalityProfile{CoupleID: actor.CoupleID, PartnerRole: actor.PartnerRole, Answers: append([]int{}, answers...), Traits: model.Traits{E: cv(result.Traits.E), A: cv(result.Traits.A), C: cv(result.Traits.C), N: cv(result.Traits.N), I: cv(result.Traits.I)}, Strengths: result.Strengths, Tips: result.Tips, CompletedAt: a.Now()}
	a.Personalities.Put(personalityKey(actor), p)
	return p, nil
}
func (a *App) PersonalityMe(actor model.Actor) (model.PersonalityProfile, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if _, err := a.couple(actor); err != nil {
		return model.PersonalityProfile{}, err
	}
	p, ok := a.Personalities.Get(personalityKey(actor))
	if !ok {
		return p, notFound()
	}
	return p, nil
}
