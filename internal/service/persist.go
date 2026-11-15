package service

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"lovelab/internal/model"
	"os"
	"path/filepath"
	"sort"
	"time"
)

const snapshotVersion = 1

// snapshot is the on-disk form. It holds only derived data: raw answers, generated
// questions/cards and in-progress sessions are never written, matching the rule
// that terminal sessions keep no private text beyond their derived result.
type snapshot struct {
	Version       int                  `json:"version"`
	SavedAt       time.Time            `json:"savedAt"`
	Couples       []model.Couple       `json:"couples"`
	Subscriptions []model.Subscription `json:"subscriptions"`
	Personalities []storedPersonality  `json:"personalities"`
	Fights        []model.FightSession `json:"completedFights"`
	Journal       []storedRecord       `json:"journal"`
}

// storedPersonality and storedRecord mirror model types whose JSON tags hide
// fields the store still needs (keys and rating submission flags).
type storedPersonality struct {
	CoupleID, PartnerRole string
	Traits                model.Traits
	Strengths, Tips       []string
	CompletedAt           time.Time
}
type storedRecord struct {
	ID, CoupleID, Topic, Color, Status string
	StartedAt                          time.Time
	BothReadyAt                        *time.Time
	RatingA, RatingB                   *int
	SubmittedA, SubmittedB             bool
	AverageRating                      *float64
	DivergenceFlag                     bool
}

func (a *App) snapshot() snapshot {
	s := snapshot{Version: snapshotVersion, SavedAt: a.Now(), Couples: a.Couples.All(), Subscriptions: a.Subscriptions.All(),
		Personalities: []storedPersonality{}, Fights: []model.FightSession{}, Journal: []storedRecord{}}
	for _, p := range a.Personalities.All() {
		s.Personalities = append(s.Personalities, storedPersonality{p.CoupleID, p.PartnerRole, p.Traits, p.Strengths, p.Tips, p.CompletedAt})
	}
	for _, f := range a.Fights.All() {
		if f.Status != "completed" {
			continue
		}
		f.Turns, f.Current, f.Checkpoint = []model.FightTurn{}, nil, nil
		s.Fights = append(s.Fights, f)
	}
	for _, r := range a.Journal.All() {
		s.Journal = append(s.Journal, storedRecord{r.ID, r.CoupleID, r.Topic, r.Color, r.Status, r.StartedAt, r.BothReadyAt, r.RatingA, r.RatingB, r.SubmittedA, r.SubmittedB, r.AverageRating, r.DivergenceFlag})
	}
	// Deterministic order keeps unchanged data byte-identical between saves.
	sort.Slice(s.Couples, func(i, j int) bool { return s.Couples[i].ID < s.Couples[j].ID })
	sort.Slice(s.Subscriptions, func(i, j int) bool { return s.Subscriptions[i].CoupleID < s.Subscriptions[j].CoupleID })
	sort.Slice(s.Personalities, func(i, j int) bool {
		return s.Personalities[i].CoupleID+s.Personalities[i].PartnerRole < s.Personalities[j].CoupleID+s.Personalities[j].PartnerRole
	})
	sort.Slice(s.Fights, func(i, j int) bool { return s.Fights[i].ID < s.Fights[j].ID })
	sort.Slice(s.Journal, func(i, j int) bool { return s.Journal[i].ID < s.Journal[j].ID })
	return s
}

// LoadFrom restores a saved snapshot. A missing file is not an error. Call it
// before StartAutosave so the restored data is not immediately rewritten.
func (a *App) LoadFrom(path string) error {
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	var s snapshot
	if err := json.Unmarshal(raw, &s); err != nil {
		return fmt.Errorf("%s is not a valid data file: %w", path, err)
	}
	if s.Version != snapshotVersion {
		return fmt.Errorf("%s has unsupported version %d", path, s.Version)
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	for _, c := range s.Couples {
		a.Couples.Put(c.ID, c)
	}
	for _, sub := range s.Subscriptions {
		a.Subscriptions.Put(sub.CoupleID, sub)
	}
	for _, p := range s.Personalities {
		actor := model.Actor{CoupleID: p.CoupleID, PartnerRole: p.PartnerRole}
		a.Personalities.Put(personalityKey(actor), model.PersonalityProfile{CoupleID: p.CoupleID, PartnerRole: p.PartnerRole, Traits: p.Traits, Strengths: p.Strengths, Tips: p.Tips, CompletedAt: p.CompletedAt})
	}
	for _, f := range s.Fights {
		a.Fights.Put(f.ID, f)
	}
	for _, r := range s.Journal {
		a.Journal.Put(r.ID, model.FightRecord{ID: r.ID, CoupleID: r.CoupleID, Topic: r.Topic, Color: r.Color, Status: r.Status, StartedAt: r.StartedAt, BothReadyAt: r.BothReadyAt, RatingA: r.RatingA, RatingB: r.RatingB, SubmittedA: r.SubmittedA, SubmittedB: r.SubmittedB, AverageRating: r.AverageRating, DivergenceFlag: r.DivergenceFlag})
	}
	return nil
}

// StartAutosave writes the store to path shortly after every change and returns
// a function that stops the writer after a final save.
func (a *App) StartAutosave(path string) (stop func()) {
	dirty := make(chan struct{}, 1)
	done := make(chan struct{})
	finished := make(chan struct{})
	notify := func() {
		select {
		case dirty <- struct{}{}:
		default:
		}
	}
	for _, hook := range []func(func()){a.Couples.OnChange, a.Fights.OnChange, a.Personalities.OnChange, a.Subscriptions.OnChange, a.Journal.OnChange} {
		hook(notify)
	}
	var last []byte
	save := func() {
		a.mu.Lock()
		data, err := json.MarshalIndent(a.snapshot(), "", "  ")
		a.mu.Unlock()
		if err == nil {
			// SavedAt changes on every call; compare without it to skip no-op writes.
			if cmp := stripSavedAt(data); !bytes.Equal(cmp, last) {
				if err = writeFileAtomic(path, data); err == nil {
					last = cmp
				}
			}
		}
		if err != nil {
			slog.Error("saving data file failed", "path", path, "error", err)
		}
	}
	go func() {
		defer close(finished)
		for {
			select {
			case <-dirty:
				time.Sleep(250 * time.Millisecond) // coalesce bursts of changes
				save()
			case <-done:
				save()
				return
			}
		}
	}()
	return func() { close(done); <-finished }
}

func stripSavedAt(data []byte) []byte {
	var m map[string]json.RawMessage
	if json.Unmarshal(data, &m) != nil {
		return data
	}
	delete(m, "savedAt")
	out, _ := json.Marshal(m)
	return out
}

func writeFileAtomic(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".lovelab-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}
