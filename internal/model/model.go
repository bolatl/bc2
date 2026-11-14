package model

import "time"

type Actor struct{ CoupleID, PartnerRole string }

type PartnerProfile struct {
	Age                string   `json:"age"`
	RelationshipStatus string   `json:"relationshipStatus"`
	TogetherDuration   string   `json:"togetherDuration"`
	HasKids            string   `json:"hasKids"`
	ConflictStyle      string   `json:"conflictStyle"`
	RepairNeed         string   `json:"repairNeed"`
	FightTopics        []string `json:"fightTopics"`
	Goal               string   `json:"goal"`
}

type Couple struct {
	ID              string
	ProfileA        PartnerProfile
	ProfileB        *PartnerProfile
	InviteToken     string
	InviteEnabled   bool
	InviteSentAt    *time.Time
	PartnerBStatus  string
	CurrentRoundID  string
	FreeSessionUsed bool
	CreatedAt       time.Time
}

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
type PersonalityProfile struct {
	CoupleID    string    `json:"-"`
	PartnerRole string    `json:"-"`
	Answers     []int     `json:"-"`
	Traits      Traits    `json:"traits"`
	Strengths   []string  `json:"strengths"`
	Tips        []string  `json:"tips"`
	CompletedAt time.Time `json:"completedAt"`
}

type FightTurn struct {
	TurnIndex     int    `json:"turnIndex"`
	Stage         string `json:"stage"`
	AgentQuestion string `json:"agentQuestion"`
	OptionLeft    string `json:"optionLeft"`
	OptionRight   string `json:"optionRight"`
	AnswerSource  string `json:"answerSource"`
	AnswerText    string `json:"answerText"`
}
type FightResult struct {
	FeltText, NeedText, OpeningLine string
	SharedRules                     []string
}
type FightSession struct {
	ID, CoupleID, PartnerRole, RoundID string
	Status, Tier, Stage, NeutralTopic  string
	Turns                              []FightTurn
	Current                            *FightTurn
	Result                             *FightResult
	ThermometerStart, ThermometerEnd   *int
	CreatedAt                          time.Time
	CompletedAt                        *time.Time
}
type Subscription struct {
	CoupleID, Plan, Status, CheckoutSessionID, CheckoutURL string
	ActivatedAt                                            *time.Time
}
type FightRecord struct {
	ID             string     `json:"id"`
	CoupleID       string     `json:"-"`
	Topic          string     `json:"topic"`
	StartedAt      time.Time  `json:"startedAt"`
	BothReadyAt    *time.Time `json:"bothReadyAt"`
	RatingA        *int       `json:"ratingA"`
	RatingB        *int       `json:"ratingB"`
	SubmittedA     bool       `json:"-"`
	SubmittedB     bool       `json:"-"`
	AverageRating  *float64   `json:"averageRating"`
	Color          string     `json:"color"`
	Status         string     `json:"status"`
	DivergenceFlag bool       `json:"divergenceFlag"`
}
