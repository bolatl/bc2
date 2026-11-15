package service

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"lovelab/internal/dto"
	"lovelab/internal/llm"
	"lovelab/internal/model"
	"lovelab/internal/payment"
	"lovelab/internal/safety"
)

var errUnsafeFight = errors.New("private safety stop")

// A turn can require several provider calls and a content-repair retry. Bound
// their combined duration below the HTTP server's thirty-second write timeout.
const requestGenerationTimeout = 25 * time.Second

// FightStart opens a private pass through the current round. Partner B only
// receives a neutral topic; no A conversation is copied into B's context.
func (a *App) FightStart(ctx context.Context, actor model.Actor) (dto.FightSessionResponse, error) {
	ctx, cancel := context.WithTimeout(ctx, requestGenerationTimeout)
	defer cancel()
	a.mu.Lock()
	defer a.mu.Unlock()
	c, err := a.couple(actor)
	if err != nil {
		return dto.FightSessionResponse{}, err
	}
	oldA, oldB := a.roundSessions(c.ID, c.CurrentRoundID)
	f := model.FightSession{ID: newID(), CoupleID: c.ID, PartnerRole: actor.PartnerRole, Status: "in_progress", Tier: "full", Stage: "thermometer_start", Turns: []model.FightTurn{}, CreatedAt: a.Now()}
	if actor.PartnerRole == "A" {
		if !canOpenRound(oldA, oldB) {
			return dto.FightSessionResponse{}, conflict("Finish or skip the current round before starting another.")
		}
		if !a.active(c.ID) {
			if c.FreeSessionUsed {
				return dto.FightSessionResponse{}, fail(402, "payment_required", "Unlock a plan to start another session.")
			}
			f.Tier = "free_short"
		}
		f.RoundID = newID()
	} else {
		if !a.active(c.ID) {
			return dto.FightSessionResponse{}, fail(402, "payment_required", "This couple needs an active plan.")
		}
		if oldA == nil || oldA.Status != "completed" {
			return dto.FightSessionResponse{}, conflict("The shared round is not ready yet.")
		}
		if oldB != nil && !stopped(oldB.Status) {
			return dto.FightSessionResponse{}, conflict("Your session for this round already exists.")
		}
		f.RoundID = c.CurrentRoundID
		f.NeutralTopic = oldA.NeutralTopic
	}
	if err = a.nextQuestion(ctx, c, &f); err != nil {
		return dto.FightSessionResponse{}, a.generationError(err)
	}
	if actor.PartnerRole == "A" {
		c.CurrentRoundID = f.RoundID
		c.InviteToken = newID()
		c.InviteEnabled = false
		c.InviteSentAt = nil
		c.PartnerBStatus = "not_invited"
		if f.Tier == "free_short" {
			c.FreeSessionUsed = true
		}
	} else {
		c.PartnerBStatus = "in_progress"
	}
	a.Couples.Put(c.ID, c)
	a.Fights.Put(f.ID, f)
	return a.fightView(c, f), nil
}

func (a *App) FightGet(actor model.Actor, id string) (dto.FightSessionResponse, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	c, f, err := a.ownedFight(actor, id)
	if err != nil {
		return dto.FightSessionResponse{}, err
	}
	return a.fightView(c, f), nil
}

func (a *App) FightTurn(ctx context.Context, actor model.Actor, id string, req dto.SubmitTurnRequest) (any, error) {
	ctx, cancel := context.WithTimeout(ctx, requestGenerationTimeout)
	defer cancel()
	a.mu.Lock()
	defer a.mu.Unlock()
	c, f, err := a.ownedFight(actor, id)
	if err != nil {
		return nil, err
	}
	if f.Status != "in_progress" && f.Status != "awaiting_payment" {
		return nil, conflict("This session no longer accepts answers.")
	}
	if f.Checkpoint != nil {
		return nil, conflict("Answer the checkpoint first: continue or stop.")
	}
	// Inspect even a stale, card-labelled, or paywalled submission before any
	// generation. Never persist the triggering text or change partner-visible data.
	if safety.Check(req.AnswerText) || unsafeHistory(f) {
		a.stopFight(&f, "stopped_safety")
		return safetyResponse(), nil
	}
	if req.TurnIndex == nil || *req.TurnIndex < 0 {
		return nil, invalid("turnIndex is required and must be non-negative.")
	}
	if f.Current == nil || *req.TurnIndex != f.Current.TurnIndex {
		return nil, conflict("The answer does not match the current turn. Reload the session.")
	}
	if f.Status == "awaiting_payment" {
		return a.paywall(c), nil
	}
	answer, err := turnAnswer(*f.Current, req)
	if err != nil {
		return nil, err
	}
	if safety.Check(answer) {
		a.stopFight(&f, "stopped_safety")
		return safetyResponse(), nil
	}
	if f.Stage == "ready" && !readyAnswer(answer) {
		return nil, invalid("Confirm readiness with 'I am ready to talk', or go back or skip this topic.")
	}
	if f.Stage == "thermometer_start" || f.Stage == "thermometer_end" {
		value, e := strconv.Atoi(answer)
		if e != nil || value < 1 || value > 10 || strconv.Itoa(value) != answer {
			return nil, invalid("A thermometer answer must be an integer string from 1 to 10.")
		}
		if f.Stage == "thermometer_start" {
			f.ThermometerStart = &value
		} else {
			f.ThermometerEnd = &value
		}
	}
	turn := *f.Current
	turn.AnswerSource = req.AnswerSource
	turn.AnswerText = answer
	f.Turns = append(f.Turns, turn)
	if f.Stage == "facts" && f.PartnerRole == "A" {
		input, e := a.fightInput(c, f)
		if e != nil {
			a.stopFight(&f, "stopped_safety")
			return safetyResponse(), nil
		}
		topic, e := a.LLM.ClassifyTopic(ctx, input)
		if e != nil {
			return nil, a.generationError(e)
		}
		if !validTopic(topic) {
			return nil, a.generationError(errors.New("invalid generated topic"))
		}
		f.NeutralTopic = topic
	}
	if f.Stage == "ready" {
		if err = a.generateResultWithReflection(ctx, c, &f); err != nil {
			if errors.Is(err, errUnsafeFight) {
				a.stopFight(&f, "stopped_safety")
				return safetyResponse(), nil
			}
			return nil, a.generationError(err)
		}
		now := a.Now()
		f.CompletedAt = &now
		f.Status = "completed"
		f.Current = nil
		f.Turns = []model.FightTurn{}
		a.Fights.Put(f.ID, f)
		if f.PartnerRole == "A" {
			c.InviteEnabled = true
			if c.InviteSentAt == nil {
				c.InviteSentAt = &now
			}
			c.PartnerBStatus = "invited"
		} else {
			c.PartnerBStatus = "ready"
		}
		a.Couples.Put(c.ID, c)
		a.recordReadyRound(c)
		return completedResponse(f), nil
	}
	stages := a.fightStages()
	next := ""
	for i, s := range stages {
		if s == f.Stage && i+1 < len(stages) {
			next = stages[i+1]
			break
		}
	}
	if next == "" || len(f.Turns) >= a.Config.MaxTurns {
		return nil, conflict("The session reached its turn limit.")
	}
	if a.checkpointDue(f, next) {
		if err = a.generateResult(ctx, c, &f); err != nil {
			if errors.Is(err, errUnsafeFight) {
				a.stopFight(&f, "stopped_safety")
				return safetyResponse(), nil
			}
			return nil, a.generationError(err)
		}
		f.Checkpoint = &model.FightCheckpoint{AfterStage: f.Stage, FeltText: f.Result.FeltText, NeedText: f.Result.NeedText, OpeningLine: f.Result.OpeningLine}
		f.Result, f.Current = nil, nil
		a.Fights.Put(f.ID, f)
		return a.fightView(c, f).CurrentTurn, nil
	}
	f.Stage = next
	if err = a.nextQuestion(ctx, c, &f); err != nil {
		if errors.Is(err, errUnsafeFight) {
			a.stopFight(&f, "stopped_safety")
			return safetyResponse(), nil
		}
		return nil, a.generationError(err)
	}
	if f.Tier == "free_short" && len(f.Turns) >= a.Config.FreeTurns {
		if err = a.generateResultWithReflection(ctx, c, &f); err != nil {
			if errors.Is(err, errUnsafeFight) {
				a.stopFight(&f, "stopped_safety")
				return safetyResponse(), nil
			}
			return nil, a.generationError(err)
		}
		f.Result.OpeningLine = ""
		f.Status = "awaiting_payment"
	}
	a.Fights.Put(f.ID, f)
	return a.fightView(c, f).CurrentTurn, nil
}

// checkpointDue reports whether an interim summary should follow the answered
// stage. It is skipped on the free teaser and when only closing steps remain,
// where "stop" and "continue" would lead to the same place.
func (a *App) checkpointDue(f model.FightSession, next string) bool {
	if !a.Config.EnableCheckpoints || f.Tier != "full" || next == "" || next == "thermometer_end" || next == "ready" {
		return false
	}
	for _, stage := range a.checkpointStages() {
		if f.Stage == stage {
			return true
		}
	}
	return false
}

// FightCheckpoint resolves a pending checkpoint. "stop" skips the remaining
// content stages and goes to the closing thermometer; "continue" resumes the
// normal order.
func (a *App) FightCheckpoint(ctx context.Context, actor model.Actor, id string, req dto.CheckpointRequest) (any, error) {
	ctx, cancel := context.WithTimeout(ctx, requestGenerationTimeout)
	defer cancel()
	a.mu.Lock()
	defer a.mu.Unlock()
	c, f, err := a.ownedFight(actor, id)
	if err != nil {
		return nil, err
	}
	if f.Status != "in_progress" || f.Checkpoint == nil {
		return nil, conflict("There is no checkpoint to answer.")
	}
	if req.Decision != "continue" && req.Decision != "stop" {
		return nil, invalid("decision must be continue or stop.")
	}
	next := a.closingStage()
	if req.Decision == "continue" {
		stages := a.fightStages()
		next = ""
		for i, s := range stages {
			if s == f.Checkpoint.AfterStage && i+1 < len(stages) {
				next = stages[i+1]
				break
			}
		}
		if next == "" {
			return nil, conflict("The session has no further stage.")
		}
	}
	f.Stage, f.Checkpoint = next, nil
	if err = a.nextQuestion(ctx, c, &f); err != nil {
		if errors.Is(err, errUnsafeFight) {
			a.stopFight(&f, "stopped_safety")
			return safetyResponse(), nil
		}
		return nil, a.generationError(err)
	}
	a.Fights.Put(f.ID, f)
	return a.fightView(c, f).CurrentTurn, nil
}

func (a *App) FightBack(ctx context.Context, actor model.Actor, id string, req dto.BackRequest) (dto.FightSessionResponse, error) {
	ctx, cancel := context.WithTimeout(ctx, requestGenerationTimeout)
	defer cancel()
	a.mu.Lock()
	defer a.mu.Unlock()
	c, f, err := a.ownedFight(actor, id)
	if err != nil {
		return dto.FightSessionResponse{}, err
	}
	if f.Status != "in_progress" && f.Status != "awaiting_payment" {
		return dto.FightSessionResponse{}, conflict("A finished or stopped session cannot be rewound.")
	}
	if unsafeHistory(f) {
		a.stopFight(&f, "stopped_safety")
		return a.fightView(c, f), nil
	}
	if req.TurnIndex == nil || *req.TurnIndex < 0 || *req.TurnIndex >= len(f.Turns) {
		return dto.FightSessionResponse{}, invalid("turnIndex must identify a previously answered turn.")
	}
	index := *req.TurnIndex
	target := f.Turns[index]
	f.Turns = append([]model.FightTurn{}, f.Turns[:index]...)
	f.Current, f.Checkpoint = nil, nil
	f.Stage = target.Stage
	f.Status = "in_progress"
	f.Result = nil
	f.ThermometerStart = nil
	f.ThermometerEnd = nil
	if f.PartnerRole == "A" && index <= 1 {
		f.NeutralTopic = ""
	}
	for _, turn := range f.Turns {
		if turn.Stage == "thermometer_start" {
			v, _ := strconv.Atoi(turn.AnswerText)
			f.ThermometerStart = &v
		}
		if turn.Stage == "thermometer_end" {
			v, _ := strconv.Atoi(turn.AnswerText)
			f.ThermometerEnd = &v
		}
	}
	if err = a.nextQuestion(ctx, c, &f); err != nil {
		if errors.Is(err, errUnsafeFight) {
			a.stopFight(&f, "stopped_safety")
			return a.fightView(c, f), nil
		}
		return dto.FightSessionResponse{}, a.generationError(err)
	}
	a.Fights.Put(f.ID, f)
	return a.fightView(c, f), nil
}

func (a *App) FightSkip(actor model.Actor, id string) (dto.FightSessionResponse, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	c, f, err := a.ownedFight(actor, id)
	if err != nil {
		return dto.FightSessionResponse{}, err
	}
	if f.Status == "skipped" {
		return a.fightView(c, f), nil
	}
	if f.Status != "in_progress" && f.Status != "awaiting_payment" {
		return dto.FightSessionResponse{}, conflict("Only an ongoing session can be skipped.")
	}
	a.stopFight(&f, "skipped")
	return a.fightView(c, f), nil
}

func (a *App) FightResult(actor model.Actor, id string) (dto.FightSessionResultResponse, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	c, f, err := a.ownedFight(actor, id)
	if err != nil {
		return dto.FightSessionResultResponse{}, err
	}
	return a.resultView(actor, c, f)
}

// resultView builds the private result of f for actor; the caller holds a.mu.
func (a *App) resultView(actor model.Actor, c model.Couple, f model.FightSession) (dto.FightSessionResultResponse, error) {
	if f.Status == "stopped_safety" {
		return dto.FightSessionResultResponse{}, fail(409, "safety_blocked", "This session was stopped privately.")
	}
	if f.Result == nil || f.Status == "skipped" {
		return dto.FightSessionResultResponse{}, conflict("A result is not available yet.")
	}
	partnerStatus := c.PartnerBStatus
	if actor.PartnerRole == "B" {
		partnerStatus = "ready"
	}
	// For a past round, report that round's readiness, not a subsequent round.
	if f.RoundID != c.CurrentRoundID && actor.PartnerRole == "A" {
		partnerStatus = "invited"
		_, other := a.roundSessions(c.ID, f.RoundID)
		if other != nil {
			partnerStatus = "in_progress"
			if other.Status == "completed" {
				partnerStatus = "ready"
			}
		}
	}
	locked := []string{}
	opening := f.Result.OpeningLine
	if f.Tier == "free_short" || f.Status != "completed" {
		opening = ""
		locked = []string{"openingLine", "inviteUrl"}
	}
	var recordID *string
	if record, ok := a.Journal.Get(f.RoundID); ok && record.CoupleID == c.ID && record.BothReadyAt != nil {
		recordID = cp(&record.ID)
	}
	var rehearsal *dto.RehearsalOptions
	if f.Current != nil && f.Current.Stage == "rehearsal" {
		rehearsal = &dto.RehearsalOptions{OptionA: f.Current.OptionLeft, OptionB: f.Current.OptionRight}
	}
	return dto.FightSessionResultResponse{SessionID: f.ID, FightRecordID: recordID, NeutralTopic: f.NeutralTopic, FeltText: f.Result.FeltText, NeedText: f.Result.NeedText, OpeningLine: opening, SharedRules: append([]string{}, f.Result.SharedRules...), PartnerStatus: partnerStatus, ThermometerStart: cp(f.ThermometerStart), ThermometerEnd: cp(f.ThermometerEnd), Tier: f.Tier, Locked: locked, Reflection: reflectionView(f.Result.Reflection, a.active(c.ID)), Rehearsal: rehearsal}, nil
}

func (a *App) ownedFight(actor model.Actor, id string) (model.Couple, model.FightSession, error) {
	c, err := a.couple(actor)
	if err != nil {
		return c, model.FightSession{}, err
	}
	f, ok := a.Fights.Get(id)
	if !ok || f.CoupleID != actor.CoupleID || f.PartnerRole != actor.PartnerRole {
		return c, f, notFound()
	}
	return c, f, nil
}
func stopped(status string) bool { return status == "skipped" || status == "stopped_safety" }
func (a *App) roundSessions(coupleID, roundID string) (*model.FightSession, *model.FightSession) {
	if roundID == "" {
		return nil, nil
	}
	var first, second *model.FightSession
	rank := func(s string) int {
		if s == "completed" {
			return 3
		}
		if stopped(s) {
			return 1
		}
		return 2
	}
	for _, f := range a.Fights.All() {
		if f.CoupleID != coupleID || f.RoundID != roundID {
			continue
		}
		dst := &first
		if f.PartnerRole == "B" {
			dst = &second
		}
		if *dst == nil || rank(f.Status) > rank((*dst).Status) || (rank(f.Status) == rank((*dst).Status) && f.CreatedAt.After((*dst).CreatedAt)) {
			copy := f
			*dst = &copy
		}
	}
	return first, second
}

// MaxAnswerChars bounds a typed answer; short answers keep prompts, generated
// follow-ups and the whole funnel short.
const MaxAnswerChars = 300

// fightStages returns the ordered stages of the configured funnel. The short
// funnel asks four questions around one thermometer; the full one keeps the
// partner-perspective stage and the closing thermometer.
func (a *App) fightStages() []string {
	if a.Config.Funnel == "full" {
		stages := []string{"thermometer_start", "facts", "feelings", "needs", "partner_view"}
		if a.Config.EnableRehearsal {
			stages = append(stages, "rehearsal")
		}
		return append(stages, "thermometer_end", "ready")
	}
	stages := []string{"thermometer_start", "facts", "feelings", "needs"}
	if a.Config.EnableRehearsal {
		stages = append(stages, "rehearsal")
	}
	return append(stages, "ready")
}

// closingStage is the first closing step after the content stages.
func (a *App) closingStage() string {
	for _, s := range a.fightStages() {
		if s == "thermometer_end" || s == "ready" {
			return s
		}
	}
	return "ready"
}

// checkpointStages are the stages after which an interim summary may be offered.
func (a *App) checkpointStages() []string {
	if a.Config.Funnel == "full" {
		return []string{"needs", "partner_view"}
	}
	return []string{"feelings"}
}

// stageProgress numbers the content stages for the UI. The full funnel keeps its
// historical fixed numbering; the short funnel counts the stages it actually has.
func (a *App) stageProgress(stage string) int {
	if a.Config.Funnel == "full" {
		return map[string]int{"facts": 1, "feelings": 2, "needs": 3, "partner_view": 4, "rehearsal": 5, "ready": 6}[stage]
	}
	n := 0
	for _, s := range a.fightStages() {
		if s == "thermometer_start" || s == "thermometer_end" {
			continue
		}
		n++
		if s == stage {
			return n
		}
	}
	return 0
}
func turnAnswer(turn model.FightTurn, req dto.SubmitTurnRequest) (string, error) {
	if utf8.RuneCountInString(req.AnswerText) > MaxAnswerChars {
		return "", invalid(fmt.Sprintf("answerText must contain at most %d characters.", MaxAnswerChars))
	}
	switch req.AnswerSource {
	case "card_left", "card_right":
		answer := turn.OptionLeft
		if req.AnswerSource == "card_right" {
			answer = turn.OptionRight
		}
		if req.AnswerText != "" && req.AnswerText != answer {
			return "", invalid("answerText must match the selected card when provided.")
		}
		return answer, nil
	case "free_text":
		answer := strings.TrimSpace(req.AnswerText)
		if answer == "" {
			return "", invalid("answerText is required for free_text.")
		}
		return answer, nil
	default:
		return "", invalid("answerSource must be card_left, card_right, or free_text.")
	}
}
func readyAnswer(s string) bool {
	s = strings.ToLower(strings.Trim(strings.TrimSpace(s), ".!"))
	s = strings.ReplaceAll(s, "’", "'")
	return contains(s, "ready", "yes", "i'm ready", "i am ready", "i'm ready to talk", "i am ready to talk", "i'm ready to send a message", "i am ready to send a message", "готов", "готова", "я готов", "я готова")
}
func unsafeHistory(f model.FightSession) bool {
	for _, turn := range f.Turns {
		if safety.Check(turn.AnswerText) {
			return true
		}
	}
	return false
}
func (a *App) fightInput(c model.Couple, f model.FightSession) (llm.Input, error) {
	profile := c.ProfileA
	if f.PartnerRole == "B" && c.ProfileB != nil {
		profile = *c.ProfileB
	}
	texts := []string{profile.PartnerName, profile.ConflictStyle, profile.RepairNeed, profile.Goal, f.NeutralTopic}
	turns := make([]llm.Turn, 0, len(f.Turns))
	for _, turn := range f.Turns {
		texts = append(texts, turn.AnswerText)
		turns = append(turns, llm.Turn{Stage: turn.Stage, AnswerText: turn.AnswerText, Question: turn.AgentQuestion, AnswerSource: turn.AnswerSource})
	}
	if safety.CheckAll(texts...) {
		return llm.Input{}, errUnsafeFight
	}
	levels := map[string]string{}
	if p, ok := a.Personalities.Get(personalityKey(model.Actor{CoupleID: c.ID, PartnerRole: f.PartnerRole})); ok {
		levels = map[string]string{"e": p.Traits.E.Level, "a": p.Traits.A.Level, "c": p.Traits.C.Level, "n": p.Traits.N.Level, "i": p.Traits.I.Level}
	}
	return llm.Input{Stage: f.Stage, NeutralTopic: f.NeutralTopic, Profile: llm.Profile{PartnerName: profile.PartnerName, ConflictStyle: profile.ConflictStyle, RepairNeed: profile.RepairNeed, Goal: profile.Goal, FightTopics: append([]string{}, profile.FightTopics...), TraitLevels: levels}, Turns: turns}, nil
}
func (a *App) nextQuestion(ctx context.Context, c model.Couple, f *model.FightSession) error {
	input, err := a.fightInput(c, *f)
	if err != nil {
		return err
	}
	question, err := a.LLM.NextTurn(ctx, input)
	if err != nil {
		return err
	}
	if strings.TrimSpace(question.AgentQuestion) == "" || strings.TrimSpace(question.OptionLeft) == "" || strings.TrimSpace(question.OptionRight) == "" {
		return errors.New("incomplete generated question")
	}
	if strings.EqualFold(strings.TrimSpace(question.OptionLeft), strings.TrimSpace(question.OptionRight)) || len(strings.Fields(question.OptionLeft)) > llm.MaxCardWords || len(strings.Fields(question.OptionRight)) > llm.MaxCardWords || utf8.RuneCountInString(question.OptionLeft) > llm.MaxCardChars || utf8.RuneCountInString(question.OptionRight) > llm.MaxCardChars {
		return errors.New("generated cards must be distinct and contain at most eight words and sixty characters")
	}
	f.Current = &model.FightTurn{TurnIndex: len(f.Turns), Stage: f.Stage, AgentQuestion: question.AgentQuestion, OptionLeft: question.OptionLeft, OptionRight: question.OptionRight}
	return nil
}
func (a *App) generateResult(ctx context.Context, c model.Couple, f *model.FightSession) error {
	input, err := a.fightInput(c, *f)
	if err != nil {
		return err
	}
	result, err := a.resultFromInput(ctx, input)
	if err != nil {
		return err
	}
	f.Result = result
	return nil
}

// resultFromInput does not touch session state and is safe to run alongside
// reflection generation using the same read-only conversation input.
func (a *App) resultFromInput(ctx context.Context, input llm.Input) (*model.FightResult, error) {
	result, err := a.LLM.FinalResult(ctx, input)
	if err != nil {
		return nil, err
	}
	if result.FeltText == "" || result.NeedText == "" || result.OpeningLine == "" || len(result.SharedRules) != 3 {
		return nil, errors.New("incomplete generated result")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	// A chosen rehearsal is an intentional saved output. Preserve that wording
	// instead of replacing it with a newly generated line in the final summary.
	// Crude or unsafe wording continues through the model's neutral paraphrase.
	for i := len(input.Turns) - 1; i >= 0; i-- {
		turn := input.Turns[i]
		if turn.Stage == "rehearsal" && strings.TrimSpace(turn.AnswerText) != "" {
			if llm.RespectfulText(turn.AnswerText) && !safety.Check(turn.AnswerText) {
				result.OpeningLine = strings.TrimSpace(turn.AnswerText)
			}
			break
		}
	}
	return &model.FightResult{FeltText: result.FeltText, NeedText: result.NeedText, OpeningLine: result.OpeningLine, SharedRules: append([]string{}, result.SharedRules...)}, nil
}
func (a *App) generationError(err error) error {
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return fail(503, "generation_unavailable", "The request timed out. Please try again.")
	}
	return fail(503, "generation_unavailable", "The next step could not be prepared. Please try again.")
}
func (a *App) stopFight(f *model.FightSession, status string) {
	f.Status = status
	f.Turns = []model.FightTurn{}
	f.Current = nil
	f.Checkpoint = nil
	f.Result = nil
	f.NeutralTopic = ""
	a.Fights.Put(f.ID, *f)
}
func safetyResponse() dto.SafetyStopResponse {
	out := dto.SafetyStopResponse{Type: "safety_stop", Hotlines: []dto.Hotline{}}
	for _, h := range safety.Hotlines() {
		out.Hotlines = append(out.Hotlines, dto.Hotline{Name: h.Name, Phone: h.Phone})
	}
	return out
}
func completedResponse(f model.FightSession) dto.CompletedResponse {
	return dto.CompletedResponse{Type: "completed", ResultURL: "/api/v1/fight-sessions/" + f.ID + "/result"}
}
func (a *App) paywall(c model.Couple) dto.PaywallResponse {
	out := dto.PaywallResponse{Type: "paywall_required", AvailablePlans: make([]dto.PlanOption, 0, 3)}
	for _, plan := range []string{"yearly", "monthly", "date_night"} {
		amount, _ := payment.Prices(plan)
		out.AvailablePlans = append(out.AvailablePlans, dto.PlanOption{Plan: plan, PriceUSD: float64(amount) / 100, IsDefault: plan == defaultPlan(c)})
	}
	return out
}
func (a *App) fightView(c model.Couple, f model.FightSession) dto.FightSessionResponse {
	out := dto.FightSessionResponse{SessionID: f.ID, Status: f.Status, Tier: f.Tier, Stage: f.Stage, Turns: append([]model.FightTurn{}, f.Turns...), ThermometerStart: cp(f.ThermometerStart), ThermometerEnd: cp(f.ThermometerEnd), CreatedAt: f.CreatedAt}
	switch f.Status {
	case "in_progress":
		if f.Checkpoint != nil {
			out.CurrentTurn = dto.CheckpointResponse{Type: "checkpoint", AfterStage: f.Checkpoint.AfterStage, Summary: dto.CheckpointSummary{FeltText: f.Checkpoint.FeltText, NeedText: f.Checkpoint.NeedText, OpeningLine: f.Checkpoint.OpeningLine}, Question: "Does this feel right so far? You can stop here or keep going.", Decisions: []string{"stop", "continue"}}
		} else if f.Current != nil {
			turn := f.Current
			var progress *int
			index := a.stageProgress(f.Stage)
			if index > 0 {
				progress = &index
			}
			max := a.Config.MaxTurns
			if f.Tier == "free_short" {
				max = a.Config.FreeTurns
			}
			out.CurrentTurn = dto.NextTurnResponse{Type: "next_turn", Stage: f.Stage, TurnIndex: turn.TurnIndex, AgentQuestion: turn.AgentQuestion, OptionLeft: turn.OptionLeft, OptionRight: turn.OptionRight, ProgressStageIndex: progress, TurnsUsed: len(f.Turns), TurnsMax: max}
		}
	case "awaiting_payment":
		out.CurrentTurn = a.paywall(c)
	case "completed":
		out.CurrentTurn = completedResponse(f)
	case "stopped_safety":
		out.CurrentTurn = safetyResponse()
	}
	return out
}
func (a *App) recordReadyRound(c model.Couple) {
	first, second := a.roundSessions(c.ID, c.CurrentRoundID)
	if first == nil || second == nil || first.Status != "completed" || second.Status != "completed" {
		return
	}
	if _, exists := a.Journal.Get(c.CurrentRoundID); exists {
		return
	}
	when := *first.CompletedAt
	if second.CompletedAt.After(when) {
		when = *second.CompletedAt
	}
	a.Journal.Put(c.CurrentRoundID, model.FightRecord{ID: c.CurrentRoundID, CoupleID: c.ID, Topic: first.NeutralTopic, StartedAt: first.CreatedAt, BothReadyAt: &when, Color: "gray", Status: "pending"})
}
