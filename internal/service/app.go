package service

import (
	"crypto/rand"
	"encoding/hex"
	"lovelab/internal/config"
	"lovelab/internal/llm"
	"lovelab/internal/model"
	"lovelab/internal/payment"
	"lovelab/internal/repository"
	"sync"
	"time"
)

type Error struct {
	Status        int
	Code, Message string
}

func (e *Error) Error() string                    { return e.Message }
func fail(status int, code, message string) error { return &Error{status, code, message} }
func invalid(message string) error                { return fail(400, "validation_error", message) }
func notFound() error                             { return fail(404, "not_found", "Resource not found.") }
func conflict(message string) error               { return fail(409, "conflict", message) }

type App struct {
	mu            sync.Mutex
	Config        config.Config
	Couples       *repository.Memory[model.Couple]
	Fights        *repository.Memory[model.FightSession]
	Personalities *repository.Memory[model.PersonalityProfile]
	Subscriptions *repository.Memory[model.Subscription]
	Journal       *repository.Memory[model.FightRecord]
	LLM           llm.Client
	Payment       payment.Client
	Now           func() time.Time
}

func New(c config.Config, l llm.Client, p payment.Client) *App {
	return &App{Config: c, LLM: l, Payment: p, Now: func() time.Time { return time.Now().UTC() }, Couples: repository.New(cloneCouple), Fights: repository.New(cloneFight), Personalities: repository.New(clonePersonality), Subscriptions: repository.New(cloneSubscription), Journal: repository.New(cloneRecord)}
}
func newID() string {
	var b [24]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic("secure random source unavailable")
	}
	return hex.EncodeToString(b[:])
}
func personalityKey(a model.Actor) string { return a.CoupleID + ":" + a.PartnerRole }
func (a *App) couple(actor model.Actor) (model.Couple, error) {
	c, ok := a.Couples.Get(actor.CoupleID)
	if !ok || (actor.PartnerRole != "A" && actor.PartnerRole != "B") || (actor.PartnerRole == "B" && c.ProfileB == nil) {
		return c, fail(401, "unauthorized", "A valid session is required.")
	}
	return c, nil
}

// active reports whether the couple has full access. DISABLE_PAYWALL grants it
// to every couple, so there is no teaser, and the journal and invite are open.
func (a *App) active(coupleID string) bool {
	if a.Config.DisablePaywall {
		return true
	}
	s, ok := a.Subscriptions.Get(coupleID)
	return ok && s.Status == "active"
}
func defaultPlan(c model.Couple) string {
	switch c.ProfileA.RelationshipStatus {
	case "engaged":
		return "program"
	case "married", "living_together":
		return "yearly"
	default:
		return "monthly"
	}
}
func contains(s string, values ...string) bool {
	for _, v := range values {
		if s == v {
			return true
		}
	}
	return false
}
func validTopic(s string) bool {
	return contains(s, "money", "chores", "family", "time_attention", "phone", "jealousy", "closeness", "plans_decisions", "kids", "other")
}

func cp[T any](p *T) *T {
	if p == nil {
		return nil
	}
	v := *p
	return &v
}
func cloneCouple(c model.Couple) model.Couple {
	c.ProfileA.FightTopics = append([]string(nil), c.ProfileA.FightTopics...)
	c.ProfileB = cp(c.ProfileB)
	if c.ProfileB != nil {
		c.ProfileB.FightTopics = append([]string(nil), c.ProfileB.FightTopics...)
	}
	c.InviteSentAt = cp(c.InviteSentAt)
	return c
}
func cloneFight(f model.FightSession) model.FightSession {
	f.Turns = append([]model.FightTurn{}, f.Turns...)
	f.Current = cp(f.Current)
	f.Checkpoint = cp(f.Checkpoint)
	f.Result = cp(f.Result)
	if f.Result != nil {
		f.Result.SharedRules = append([]string{}, f.Result.SharedRules...)
	}
	f.ThermometerStart = cp(f.ThermometerStart)
	f.ThermometerEnd = cp(f.ThermometerEnd)
	f.CompletedAt = cp(f.CompletedAt)
	return f
}
func clonePersonality(p model.PersonalityProfile) model.PersonalityProfile {
	p.Answers = append([]int{}, p.Answers...)
	p.Strengths = append([]string{}, p.Strengths...)
	p.Tips = append([]string{}, p.Tips...)
	return p
}
func cloneSubscription(s model.Subscription) model.Subscription {
	s.ActivatedAt = cp(s.ActivatedAt)
	return s
}
func cloneRecord(r model.FightRecord) model.FightRecord {
	r.BothReadyAt = cp(r.BothReadyAt)
	r.RatingA = cp(r.RatingA)
	r.RatingB = cp(r.RatingB)
	r.AverageRating = cp(r.AverageRating)
	return r
}
