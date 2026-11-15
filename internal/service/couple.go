package service

import (
	"lovelab/internal/dto"
	"lovelab/internal/model"
	"net/url"
	"strings"
	"unicode"
	"unicode/utf8"
)

func validateProfile(p model.PartnerProfile, full bool) error {
	if p.Age != "" && !contains(p.Age, "25-29", "30-34", "35-39", "40-45", "other") {
		return invalid("Choose a valid age range.")
	}
	if !contains(p.ConflictStyle, "talk_now", "need_space", "get_loud", "shut_down") {
		return invalid("Choose a valid conflictStyle.")
	}
	if !contains(p.RepairNeed, "being_heard", "apology", "plan", "closeness", "alone_time") {
		return invalid("Choose a valid repairNeed.")
	}
	if !full {
		return nil
	}
	if p.PartnerName != "" {
		name := strings.TrimSpace(p.PartnerName)
		if name == "" || utf8.RuneCountInString(name) > 20 || strings.IndexFunc(name, func(r rune) bool { return unicode.IsControl(r) || unicode.Is(unicode.Cf, r) }) >= 0 {
			return invalid("partnerName must contain between one and twenty visible characters.")
		}
	}
	if p.Source != "" && !contains(p.Source, "instagram_facebook", "tiktok", "google", "partner_link", "friend", "other") {
		return invalid("Choose a valid source.")
	}
	if !contains(p.RelationshipStatus, "dating", "living_together", "engaged", "married") {
		return invalid("Choose a valid relationshipStatus.")
	}
	if p.TogetherDuration != "" && !contains(p.TogetherDuration, "<1", "1-3", "3-7", "7+") {
		return invalid("Choose a valid togetherDuration.")
	}
	if p.HasKids != "" && !contains(p.HasKids, "no", "expecting", "yes") {
		return invalid("Choose a valid hasKids value.")
	}
	if p.Goal != "" && !contains(p.Goal, "fewer_fights", "understand_each_other", "prepare_marriage", "feel_close") {
		return invalid("Choose a valid goal.")
	}
	if (p.FightTopics != nil && len(p.FightTopics) < 1) || len(p.FightTopics) > 3 {
		return invalid("Choose between one and three fightTopics.")
	}
	seen := map[string]bool{}
	for _, t := range p.FightTopics {
		if !validTopic(t) || seen[t] {
			return invalid("fightTopics must contain distinct supported topics.")
		}
		seen[t] = true
	}
	return nil
}
func (a *App) CreateCouple(p dto.CreateCoupleRequest) (dto.CoupleResponse, model.Actor, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := validateProfile(p, true); err != nil {
		return dto.CoupleResponse{}, model.Actor{}, err
	}
	p.PartnerName = strings.TrimSpace(p.PartnerName)
	c := model.Couple{ID: newID(), ProfileA: p, InviteToken: newID(), PartnerBStatus: "not_invited", CreatedAt: a.Now()}
	a.Couples.Put(c.ID, c)
	actor := model.Actor{CoupleID: c.ID, PartnerRole: "A"}
	return a.coupleResponse(c, actor), actor, nil
}
func (a *App) CoupleMe(actor model.Actor) (dto.CoupleResponse, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	c, err := a.couple(actor)
	if err != nil {
		return dto.CoupleResponse{}, err
	}
	return a.coupleResponse(c, actor), nil
}
func (a *App) coupleResponse(c model.Couple, actor model.Actor) dto.CoupleResponse {
	out := dto.CoupleResponse{CoupleID: c.ID, PartnerRole: actor.PartnerRole, PartnerBStatus: c.PartnerBStatus, PartnerBInviteSentAt: c.InviteSentAt, DefaultPlan: defaultPlan(c), CreatedAt: c.CreatedAt}
	if actor.PartnerRole == "A" {
		out.PartnerName = c.ProfileA.PartnerName
		out.OwnProfile = copyProfile(c.ProfileA)
	} else if c.ProfileB != nil {
		out.PartnerName = c.ProfileB.PartnerName
		out.OwnProfile = copyProfile(*c.ProfileB)
	}
	// Restore only this actor's own attempt in the current round. Completed,
	// skipped and privately stopped attempts remain reloadable by their owner.
	first, second := a.roundSessions(c.ID, c.CurrentRoundID)
	out.PartnerStatus = otherPreparationStatus(actor.PartnerRole, first, second)
	current := first
	if actor.PartnerRole == "B" {
		current = second
	}
	if current != nil {
		out.CurrentSessionID = cp(&current.ID)
	}
	if c.InviteEnabled && a.active(c.ID) && actor.PartnerRole == "A" {
		out.InviteURL = a.Config.FrontendURL + "/invites/" + url.PathEscape(c.InviteToken)
	}
	if s, ok := a.Subscriptions.Get(c.ID); ok {
		out.Subscription = &dto.SubscriptionResponse{Plan: s.Plan, Status: s.Status, ActivatedAt: s.ActivatedAt}
	}
	_, out.PersonalityDone = a.Personalities.Get(personalityKey(actor))
	return out
}

func copyProfile(profile model.PartnerProfile) *model.PartnerProfile {
	if profile.FightTopics != nil {
		profile.FightTopics = append([]string{}, profile.FightTopics...)
	}
	return &profile
}
func (a *App) DeleteCouple(actor model.Actor) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if _, err := a.couple(actor); err != nil {
		return err
	}
	for _, f := range a.Fights.All() {
		if f.CoupleID == actor.CoupleID {
			a.Fights.Delete(f.ID)
		}
	}
	for _, r := range a.Journal.All() {
		if r.CoupleID == actor.CoupleID {
			a.Journal.Delete(r.ID)
		}
	}
	for _, role := range []string{"A", "B"} {
		a.Personalities.Delete(personalityKey(model.Actor{CoupleID: actor.CoupleID, PartnerRole: role}))
	}
	a.Subscriptions.Delete(actor.CoupleID)
	if payments, ok := a.Payment.(interface{ DeleteCouple(string) }); ok {
		payments.DeleteCouple(actor.CoupleID)
	}
	a.Couples.Delete(actor.CoupleID)
	return nil
}
func (a *App) invite(token string) (model.Couple, error) {
	for _, c := range a.Couples.All() {
		if c.InviteToken == token && c.InviteEnabled && a.active(c.ID) {
			return c, nil
		}
	}
	return model.Couple{}, notFound()
}
func (a *App) neutralTopic(c model.Couple) *string {
	for _, f := range a.Fights.All() {
		if f.CoupleID == c.ID && f.RoundID == c.CurrentRoundID && f.PartnerRole == "A" && f.Status == "completed" && validTopic(f.NeutralTopic) {
			return cp(&f.NeutralTopic)
		}
	}
	return nil
}
func (a *App) InvitePreview(token string) (dto.InviteResponse, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	c, err := a.invite(token)
	if err != nil {
		return dto.InviteResponse{}, err
	}
	return dto.InviteResponse{NeutralTopic: a.neutralTopic(c), Message: "Your partner is ready to talk. Take a few minutes to prepare privately; your answers stay yours."}, nil
}
func (a *App) JoinInvite(token string, p dto.JoinInviteRequest, existing *model.Actor) (dto.JoinInviteResponse, model.Actor, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	c, err := a.invite(token)
	if err != nil {
		return dto.JoinInviteResponse{}, model.Actor{}, err
	}
	profile := model.PartnerProfile{Age: p.Age, ConflictStyle: p.ConflictStyle, RepairNeed: p.RepairNeed}
	if err := validateProfile(profile, false); err != nil {
		return dto.JoinInviteResponse{}, model.Actor{}, err
	}
	actor := model.Actor{CoupleID: c.ID, PartnerRole: "B"}
	if existing != nil && existing.CoupleID == c.ID && existing.PartnerRole == "A" {
		return dto.JoinInviteResponse{}, model.Actor{}, conflict("Open the partner invitation in a separate browser profile.")
	}
	if c.ProfileB != nil && (existing == nil || *existing != actor) {
		return dto.JoinInviteResponse{}, model.Actor{}, conflict("This invitation has already been accepted.")
	}
	if c.ProfileB == nil {
		profile.RelationshipStatus = c.ProfileA.RelationshipStatus
		profile.TogetherDuration = c.ProfileA.TogetherDuration
		profile.HasKids = c.ProfileA.HasKids
		profile.Goal = c.ProfileA.Goal
		c.ProfileB = &profile
		c.PartnerBStatus = "in_progress"
		a.Couples.Put(c.ID, c)
	}
	return dto.JoinInviteResponse{CoupleID: c.ID, PartnerRole: "B", NeutralTopic: a.neutralTopic(c)}, actor, nil
}
