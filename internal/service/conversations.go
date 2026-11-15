package service

import (
	"sort"

	"lovelab/internal/dto"
	"lovelab/internal/model"
)

// canOpenRound never interrupts a partner who has started preparing. A private
// stop must not enable a new round and reveal that stop to the other partner.
func canOpenRound(first, second *model.FightSession) bool {
	if first == nil {
		return true
	}
	if first.Status != "completed" && !stopped(first.Status) {
		return false
	}
	return second == nil || second.Status == "completed"
}

func otherPreparationStatus(role string, first, second *model.FightSession) string {
	other := second
	if role == "B" {
		other = first
	}
	if other == nil {
		return "not_started"
	}
	if other.Status == "completed" {
		return "ready"
	}
	// Never distinguish skipped/safety-stopped from still preparing.
	return "in_progress"
}

// Conversations is the caller's own history, including incomplete preparation.
// It deliberately contains no answers, generated summaries or partner profiles.
// Unlike the shared check-in journal, reading one's own history needs no plan.
func (a *App) Conversations(actor model.Actor) (dto.ConversationListResponse, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	c, err := a.couple(actor)
	if err != nil {
		return dto.ConversationListResponse{}, err
	}
	first, second := a.roundSessions(c.ID, c.CurrentRoundID)
	out := dto.ConversationListResponse{Conversations: []dto.ConversationSummary{}, CanStartNew: canOpenRound(first, second)}
	if actor.PartnerRole == "B" {
		out.CanStartNew = first != nil && first.Status == "completed" && (second == nil || stopped(second.Status))
	}
	current := a.coupleResponse(c, actor)
	for _, f := range a.Fights.All() {
		if f.CoupleID != c.ID || f.PartnerRole != actor.PartnerRole {
			continue
		}
		row := dto.ConversationSummary{
			SessionID: f.ID, Status: f.Status, Tier: f.Tier, Stage: f.Stage,
			CreatedAt: f.CreatedAt, CompletedAt: cp(f.CompletedAt),
			IsCurrent:       current.CurrentSessionID != nil && f.ID == *current.CurrentSessionID,
			ResultAvailable: f.Result != nil && !stopped(f.Status),
		}
		if validTopic(f.NeutralTopic) {
			row.NeutralTopic = cp(&f.NeutralTopic)
		}
		if record, ok := a.Journal.Get(f.RoundID); ok && record.CoupleID == c.ID {
			row.FightRecordID = cp(&record.ID)
		}
		owner, partner := a.roundSessions(c.ID, f.RoundID)
		row.PartnerStatus = otherPreparationStatus(actor.PartnerRole, owner, partner)
		if row.IsCurrent {
			row.InviteURL = current.InviteURL
		}
		out.Conversations = append(out.Conversations, row)
	}
	sort.Slice(out.Conversations, func(i, j int) bool {
		if out.Conversations[i].CreatedAt.Equal(out.Conversations[j].CreatedAt) {
			return out.Conversations[i].SessionID < out.Conversations[j].SessionID
		}
		return out.Conversations[i].CreatedAt.After(out.Conversations[j].CreatedAt)
	})
	return out, nil
}
