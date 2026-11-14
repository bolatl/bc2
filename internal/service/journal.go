package service

import (
	"lovelab/internal/dto"
	"lovelab/internal/model"
	"math"
	"sort"
)

func (a *App) paidCouple(actor model.Actor) error {
	if _, err := a.couple(actor); err != nil {
		return err
	}
	if !a.active(actor.CoupleID) {
		return fail(402, "payment_required", "Unlock the full session to access the journal.")
	}
	return nil
}
func (a *App) journalRecords(coupleID string) []model.FightRecord {
	out := []model.FightRecord{}
	for _, r := range a.Journal.All() {
		if r.CoupleID == coupleID {
			out = append(out, r)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].StartedAt.Equal(out[j].StartedAt) {
			return out[i].ID < out[j].ID
		}
		return out[i].StartedAt.Before(out[j].StartedAt)
	})
	return out
}
func (a *App) JournalList(actor model.Actor) ([]model.FightRecord, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.paidCouple(actor); err != nil {
		return nil, err
	}
	return a.journalRecords(actor.CoupleID), nil
}
func (a *App) Rate(actor model.Actor, id string, rating *int) (model.FightRecord, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.paidCouple(actor); err != nil {
		return model.FightRecord{}, err
	}
	if rating != nil && (*rating < 1 || *rating > 10) {
		return model.FightRecord{}, invalid("rating must be an integer between 1 and 10, or null.")
	}
	r, ok := a.Journal.Get(id)
	if !ok || r.CoupleID != actor.CoupleID {
		return model.FightRecord{}, notFound()
	}
	if r.BothReadyAt == nil {
		return model.FightRecord{}, conflict("Both partners must be ready before rating.")
	}
	if actor.PartnerRole == "A" {
		r.RatingA = cp(rating)
		r.SubmittedA = true
	} else {
		r.RatingB = cp(rating)
		r.SubmittedB = true
	}
	r.AverageRating = nil
	r.DivergenceFlag = false
	r.Color = "gray"
	r.Status = "pending"
	switch {
	case (r.SubmittedA && r.RatingA == nil) || (r.SubmittedB && r.RatingB == nil):
		r.Status = "not_discussed"
	case r.SubmittedA && r.SubmittedB:
		avg := float64(*r.RatingA+*r.RatingB) / 2
		r.AverageRating = &avg
		r.Status = "rated"
		r.Color = "red"
		if avg >= 8 {
			r.Color = "green"
		} else if avg >= 5 {
			r.Color = "yellow"
		}
		r.DivergenceFlag = math.Abs(float64(*r.RatingA-*r.RatingB)) >= float64(a.Config.DivergenceThreshold)
	}
	a.Journal.Put(id, r)
	return r, nil
}
func (a *App) JournalStats(actor model.Actor) (dto.JournalStatsResponse, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.paidCouple(actor); err != nil {
		return dto.JournalStatsResponse{}, err
	}
	records := a.journalRecords(actor.CoupleID)
	s := dto.JournalStatsResponse{TotalFights: len(records), TopicCounts: map[string]int{}, AverageRatingTrend: []float64{}}
	var elapsed float64
	ready := 0
	bestCount := 2
	bestTopic := ""
	for _, r := range records {
		s.TopicCounts[r.Topic]++
		if r.AverageRating != nil {
			s.AverageRatingTrend = append(s.AverageRatingTrend, *r.AverageRating)
		}
		if r.BothReadyAt != nil {
			elapsed += math.Max(0, r.BothReadyAt.Sub(r.StartedAt).Seconds())
			ready++
		}
	}
	if ready > 0 {
		s.AvgTimeToBothReadySeconds = int(elapsed / float64(ready))
	}
	for topic, n := range s.TopicCounts {
		if n > bestCount || (n == bestCount && n >= 3 && (bestTopic == "" || topic < bestTopic)) {
			bestTopic = topic
			bestCount = n
		}
	}
	if bestTopic != "" {
		s.RecurringTopicHint = &bestTopic
	}
	return s, nil
}
