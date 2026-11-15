package service

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"lovelab/internal/config"
	"lovelab/internal/dto"
	"lovelab/internal/llm"
	"lovelab/internal/model"
)

// finishedRound runs A and B to completion with the paywall off.
func finishedRound(t *testing.T) (*App, model.Actor, model.Actor, string) {
	t.Helper()
	app, a, _ := fightApp(t, false)
	app.Config.DisablePaywall = true
	first := startFight(t, app, a)
	finishFight(t, app, a, first.SessionID)
	b := addPartner(t, app, a)
	second := startFight(t, app, b)
	finishFight(t, app, b, second.SessionID)
	records := app.Journal.All()
	if len(records) != 1 {
		t.Fatalf("expected one journal record, got %d", len(records))
	}
	return app, a, b, records[0].ID
}

func TestSnapshotRoundTripKeepsHistoryAndDropsRawText(t *testing.T) {
	app, a, b, recordID := finishedRound(t)
	rating := 7
	if _, err := app.Rate(a, recordID, &rating); err != nil {
		t.Fatal(err)
	}
	if _, err := app.SubmitPersonality(a, []int{3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3}); err != nil {
		t.Fatal(err)
	}
	// An in-progress session holds raw answers and must never reach the disk.
	live := startFight(t, app, a)
	answerFight(t, app, a, live.SessionID, "8")
	answerFight(t, app, a, live.SessionID, "secret-in-progress-marker")

	path := filepath.Join(t.TempDir(), "data", "lovelab.json")
	stop := app.StartAutosave(path)
	app.Couples.Put(a.CoupleID, mustCouple(t, app, a)) // trigger a save
	stop()

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "secret-in-progress-marker") || strings.Contains(string(raw), "private-") {
		t.Fatal("raw answer text reached the data file")
	}
	if info, _ := os.Stat(path); info.Mode().Perm() != 0o600 {
		t.Fatalf("data file mode %v", info.Mode().Perm())
	}

	restored := New(config.Default(), llm.NewMock(), nil)
	restored.Config.DisablePaywall = true
	if err := restored.LoadFrom(path); err != nil {
		t.Fatal(err)
	}
	entry, err := restored.JournalGet(a, recordID)
	if err != nil {
		t.Fatal(err)
	}
	if entry.RatingA == nil || *entry.RatingA != 7 || entry.MyResult == nil || entry.MyResult.FeltText == "" {
		t.Fatalf("history not restored: %#v", entry)
	}
	if _, err := restored.JournalGet(b, recordID); err != nil {
		t.Fatal(err)
	}
	if _, err := restored.PersonalityMe(a); err != nil {
		t.Fatal("personality result lost")
	}
	// B's rating flag must survive so the average is computed after restart.
	rb := 3
	out, err := restored.Rate(b, recordID, &rb)
	if err != nil || out.AverageRating == nil || *out.AverageRating != 5 {
		t.Fatalf("rating after restore: %#v %v", out, err)
	}
	if _, ok := restored.Fights.Get(live.SessionID); ok {
		t.Fatal("in-progress session was persisted")
	}
}

func TestLoadFromRejectsCorruptAndMissingFile(t *testing.T) {
	app := New(config.Default(), llm.NewMock(), nil)
	dir := t.TempDir()
	if err := app.LoadFrom(filepath.Join(dir, "absent.json")); err != nil {
		t.Fatal("missing file must be fine:", err)
	}
	bad := filepath.Join(dir, "bad.json")
	_ = os.WriteFile(bad, []byte("{not json"), 0o600)
	if err := app.LoadFrom(bad); err == nil {
		t.Fatal("corrupt file accepted")
	}
}

func TestJournalEntryShowsOnlyCallersOwnResult(t *testing.T) {
	app, a, b, id := finishedRound(t)
	ea, err := app.JournalGet(a, id)
	if err != nil || ea.MyResult == nil {
		t.Fatalf("A entry: %#v %v", ea, err)
	}
	eb, err := app.JournalGet(b, id)
	if err != nil || eb.MyResult == nil || eb.MyResult.SessionID == ea.MyResult.SessionID {
		t.Fatalf("B must see its own session result: %#v %v", eb, err)
	}
	if _, err := app.JournalGet(model.Actor{CoupleID: "other", PartnerRole: "A"}, id); err == nil {
		t.Fatal("foreign couple read a journal entry")
	}
}

func checkpointApp(t *testing.T) (*App, model.Actor) {
	t.Helper()
	app, a, _ := fightApp(t, true)
	app.Config.EnableCheckpoints = true
	app.Config.Funnel = "full"
	return app, a
}

func TestCheckpointContinueAndStop(t *testing.T) {
	app, a := checkpointApp(t)
	f := startFight(t, app, a)
	for _, text := range []string{"8", "dishes", "alone"} {
		answerFight(t, app, a, f.SessionID, text)
	}
	out := answerFight(t, app, a, f.SessionID, "A clear plan")
	cp1, ok := out.(dto.CheckpointResponse)
	if !ok || cp1.AfterStage != "needs" || cp1.Summary.FeltText == "" || cp1.Summary.OpeningLine == "" || len(cp1.Decisions) != 2 {
		t.Fatalf("expected a needs checkpoint, got %#v", out)
	}
	if _, ok := getFight(t, app, a, f.SessionID).CurrentTurn.(dto.CheckpointResponse); !ok {
		t.Fatal("GET must keep showing the pending checkpoint")
	}
	if _, err := app.FightTurn(context.Background(), a, f.SessionID, dto.SubmitTurnRequest{TurnIndex: cpInt(4), AnswerSource: "free_text", AnswerText: "x"}); err == nil {
		t.Fatal("a turn was accepted while a checkpoint is pending")
	}
	if _, err := app.FightCheckpoint(context.Background(), a, f.SessionID, dto.CheckpointRequest{Decision: "maybe"}); err == nil {
		t.Fatal("invalid decision accepted")
	}
	next, err := app.FightCheckpoint(context.Background(), a, f.SessionID, dto.CheckpointRequest{Decision: "continue"})
	if err != nil || next.(dto.NextTurnResponse).Stage != "partner_view" {
		t.Fatalf("continue: %#v %v", next, err)
	}
	// Without rehearsal only closing steps follow partner_view, so no second checkpoint.
	after := answerFight(t, app, a, f.SessionID, "maybe tired")
	if after.(dto.NextTurnResponse).Stage != "thermometer_end" {
		t.Fatalf("unexpected stage after partner_view: %#v", after)
	}
	if _, err := app.FightCheckpoint(context.Background(), a, f.SessionID, dto.CheckpointRequest{Decision: "stop"}); err == nil {
		t.Fatal("checkpoint accepted when none is pending")
	}

	// Stop: partner_view is skipped, the closing thermometer comes next, then ready completes.
	app2, a2 := checkpointApp(t)
	g := startFight(t, app2, a2)
	for _, text := range []string{"8", "dishes", "alone", "A clear plan"} {
		answerFight(t, app2, a2, g.SessionID, text)
	}
	stopped, err := app2.FightCheckpoint(context.Background(), a2, g.SessionID, dto.CheckpointRequest{Decision: "stop"})
	if err != nil || stopped.(dto.NextTurnResponse).Stage != "thermometer_end" {
		t.Fatalf("stop: %#v %v", stopped, err)
	}
	finishFight(t, app2, a2, g.SessionID)
	res, err := app2.FightResult(a2, g.SessionID)
	if err != nil || res.FeltText == "" {
		t.Fatalf("result after early stop: %#v %v", res, err)
	}
}

func TestCheckpointRewindClearsPendingAndFreeTierHasNone(t *testing.T) {
	app, a := checkpointApp(t)
	f := startFight(t, app, a)
	for _, text := range []string{"8", "dishes", "alone", "A clear plan"} {
		answerFight(t, app, a, f.SessionID, text)
	}
	back, err := app.FightBack(context.Background(), a, f.SessionID, dto.BackRequest{TurnIndex: cpInt(3)})
	if err != nil || back.CurrentTurn.(dto.NextTurnResponse).Stage != "needs" {
		t.Fatalf("rewind: %#v %v", back, err)
	}
	free, freeActor, _ := fightApp(t, false)
	free.Config.EnableCheckpoints = true
	free.Config.Funnel = "full"
	g := startFight(t, free, freeActor)
	for _, text := range []string{"8", "dishes", "alone"} {
		answerFight(t, free, freeActor, g.SessionID, text)
	}
	if _, ok := answerFight(t, free, freeActor, g.SessionID, "A clear plan").(dto.PaywallResponse); !ok {
		t.Fatal("free tier must hit the paywall, not a checkpoint")
	}
}

func cpInt(n int) *int { return &n }
func mustCouple(t *testing.T, app *App, a model.Actor) model.Couple {
	t.Helper()
	c, ok := app.Couples.Get(a.CoupleID)
	if !ok {
		t.Fatal("couple missing")
	}
	return c
}

func TestShortFunnelHasFiveQuestionsAndCheckpointAfterFeelings(t *testing.T) {
	app, a, _ := fightApp(t, true)
	if got := strings.Join(app.fightStages(), ","); got != "thermometer_start,facts,feelings,needs,ready" {
		t.Fatalf("short funnel stages: %s", got)
	}
	app.Config.EnableCheckpoints = true
	f := startFight(t, app, a)
	for _, text := range []string{"8", "dishes"} {
		answerFight(t, app, a, f.SessionID, text)
	}
	out := answerFight(t, app, a, f.SessionID, "alone")
	if cp1, ok := out.(dto.CheckpointResponse); !ok || cp1.AfterStage != "feelings" {
		t.Fatalf("expected a feelings checkpoint, got %#v", out)
	}
	next, err := app.FightCheckpoint(context.Background(), a, f.SessionID, dto.CheckpointRequest{Decision: "stop"})
	if err != nil || next.(dto.NextTurnResponse).Stage != "ready" {
		t.Fatalf("stop must jump to ready in the short funnel: %#v %v", next, err)
	}
	finishFight(t, app, a, f.SessionID)

	// Without a checkpoint the session needs exactly five answers.
	app2, a2, _ := fightApp(t, true)
	g := startFight(t, app2, a2)
	turns := 0
	for getFight(t, app2, a2, g.SessionID).Status != "completed" {
		answer := "8"
		if getFight(t, app2, a2, g.SessionID).CurrentTurn.(dto.NextTurnResponse).Stage == "ready" {
			answer = "I am ready to talk"
		}
		answerFight(t, app2, a2, g.SessionID, answer)
		turns++
		if turns > 6 {
			t.Fatal("short funnel did not finish")
		}
	}
	if turns != 5 {
		t.Fatalf("short funnel took %d answers, want 5", turns)
	}
}

func TestShortFunnelProgressIndexCountsContentStages(t *testing.T) {
	app, _, _ := fightApp(t, true)
	want := map[string]int{"facts": 1, "feelings": 2, "needs": 3, "ready": 4, "thermometer_start": 0}
	for stage, n := range want {
		if got := app.stageProgress(stage); got != n {
			t.Fatalf("progress(%s)=%d want %d", stage, got, n)
		}
	}
}

func TestTypedAnswerIsLimited(t *testing.T) {
	app, a, _ := fightApp(t, true)
	f := startFight(t, app, a)
	answerFight(t, app, a, f.SessionID, "8")
	turn := getFight(t, app, a, f.SessionID).CurrentTurn.(dto.NextTurnResponse)
	long := strings.Repeat("a", MaxAnswerChars+1)
	if _, err := app.FightTurn(context.Background(), a, f.SessionID, dto.SubmitTurnRequest{TurnIndex: &turn.TurnIndex, AnswerSource: "free_text", AnswerText: long}); err == nil {
		t.Fatal("over-long answer accepted")
	}
	ok := strings.Repeat("a", MaxAnswerChars)
	if _, err := app.FightTurn(context.Background(), a, f.SessionID, dto.SubmitTurnRequest{TurnIndex: &turn.TurnIndex, AnswerSource: "free_text", AnswerText: ok}); err != nil {
		t.Fatal(err)
	}
}
