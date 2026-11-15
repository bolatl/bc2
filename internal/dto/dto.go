package dto

import (
	"lovelab/internal/model"
	"time"
)

type CreateCoupleRequest = model.PartnerProfile
type JoinInviteRequest struct {
	Age           string `json:"age"`
	ConflictStyle string `json:"conflictStyle"`
	RepairNeed    string `json:"repairNeed"`
}
type SubscriptionResponse struct {
	Plan        string     `json:"plan"`
	Status      string     `json:"status"`
	ActivatedAt *time.Time `json:"activatedAt"`
}
type CoupleResponse struct {
	CoupleID             string                `json:"coupleId"`
	PartnerRole          string                `json:"partnerRole"`
	CurrentSessionID     *string               `json:"currentSessionId"`
	InviteURL            string                `json:"inviteUrl"`
	PartnerBStatus       string                `json:"partnerBStatus"`
	PartnerBInviteSentAt *time.Time            `json:"partnerBInviteSentAt"`
	DefaultPlan          string                `json:"defaultPlan"`
	Subscription         *SubscriptionResponse `json:"subscription"`
	PersonalityDone      bool                  `json:"personalityDone"`
	CreatedAt            time.Time             `json:"createdAt"`
}
type InviteResponse struct {
	NeutralTopic *string `json:"neutralTopic"`
	Message      string  `json:"message"`
}
type JoinInviteResponse struct {
	CoupleID     string  `json:"coupleId"`
	PartnerRole  string  `json:"partnerRole"`
	NeutralTopic *string `json:"neutralTopic"`
}
type SubmitPersonalityTestRequest struct {
	Answers []int `json:"answers"`
}
type SubmitTurnRequest struct {
	TurnIndex    *int   `json:"turnIndex"`
	AnswerSource string `json:"answerSource"`
	AnswerText   string `json:"answerText"`
}
type BackRequest struct {
	TurnIndex *int `json:"turnIndex"`
}
type NextTurnResponse struct {
	Type               string `json:"type"`
	Stage              string `json:"stage"`
	TurnIndex          int    `json:"turnIndex"`
	AgentQuestion      string `json:"agentQuestion"`
	OptionLeft         string `json:"optionLeft"`
	OptionRight        string `json:"optionRight"`
	ProgressStageIndex *int   `json:"progressStageIndex"`
	TurnsUsed          int    `json:"turnsUsed"`
	TurnsMax           int    `json:"turnsMax"`
}
type PlanOption struct {
	Plan      string  `json:"plan"`
	PriceUSD  float64 `json:"priceUsd"`
	IsDefault bool    `json:"isDefault"`
}
type PaywallResponse struct {
	Type           string       `json:"type"`
	AvailablePlans []PlanOption `json:"availablePlans"`
}
type Hotline struct {
	Name  string `json:"name"`
	Phone string `json:"phone"`
}
type SafetyStopResponse struct {
	Type     string    `json:"type"`
	Hotlines []Hotline `json:"hotlines"`
}
type CompletedResponse struct {
	Type      string `json:"type"`
	ResultURL string `json:"resultUrl"`
}
type FightSessionResponse struct {
	SessionID        string            `json:"sessionId"`
	Status           string            `json:"status"`
	Tier             string            `json:"tier"`
	Stage            string            `json:"stage"`
	Turns            []model.FightTurn `json:"turns"`
	CurrentTurn      any               `json:"currentTurn"`
	ThermometerStart *int              `json:"thermometerStart"`
	ThermometerEnd   *int              `json:"thermometerEnd"`
	CreatedAt        time.Time         `json:"createdAt"`
}
type FightSessionResultResponse struct {
	SessionID        string   `json:"sessionId"`
	FightRecordID    *string  `json:"fightRecordId"`
	NeutralTopic     string   `json:"neutralTopic"`
	FeltText         string   `json:"feltText"`
	NeedText         string   `json:"needText"`
	OpeningLine      string   `json:"openingLine"`
	SharedRules      []string `json:"sharedRules"`
	PartnerStatus    string   `json:"partnerStatus"`
	ThermometerStart *int     `json:"thermometerStart"`
	ThermometerEnd   *int     `json:"thermometerEnd"`
	Tier             string   `json:"tier"`
	Locked           []string `json:"locked"`
}
type CreateCheckoutRequest struct {
	Plan string `json:"plan"`
}
type CreateCheckoutResponse struct {
	CheckoutURL       string `json:"checkoutUrl"`
	CheckoutSessionID string `json:"checkoutSessionId"`
}
type ConfirmCheckoutRequest struct {
	CheckoutSessionID string `json:"checkoutSessionId"`
}
type SubmitRatingRequest struct {
	Rating *int `json:"rating"`
}
type JournalStatsResponse struct {
	TotalFights               int            `json:"totalFights"`
	TopicCounts               map[string]int `json:"topicCounts"`
	AverageRatingTrend        []float64      `json:"averageRatingTrend"`
	AvgTimeToBothReadySeconds int            `json:"avgTimeToBothReadySeconds"`
	RecurringTopicHint        *string        `json:"recurringTopicHint"`
}
