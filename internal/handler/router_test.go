package handler

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"

	"lovelab/internal/config"
	"lovelab/internal/llm"
	"lovelab/internal/payment"
	"lovelab/internal/service"
)

type browser struct {
	router http.Handler
	cookie *http.Cookie
}

func (b *browser) request(method, path, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	if b.cookie != nil {
		req.AddCookie(b.cookie)
	}
	w := httptest.NewRecorder()
	b.router.ServeHTTP(w, req)
	for _, c := range w.Result().Cookies() {
		if c.MaxAge < 0 {
			b.cookie = nil
		} else {
			b.cookie = c
		}
	}
	return w
}
func check(t *testing.T, w *httptest.ResponseRecorder, status int) map[string]any {
	t.Helper()
	if w.Code != status {
		t.Fatalf("want HTTP %d got %d: %s", status, w.Code, w.Body.String())
	}
	var out map[string]any
	if status != 204 && json.Unmarshal(w.Body.Bytes(), &out) != nil {
		t.Fatalf("invalid object: %s", w.Body.String())
	}
	return out
}
func setup(t *testing.T) (*service.App, *browser) {
	t.Helper()
	c := config.Default()
	c.SessionSecret = strings.Repeat("x", 32)
	app := service.New(c, llm.NewMock(), payment.NewMock(c.FrontendURL))
	return app, &browser{router: New(app)}
}

const profile = `{"age":"30-34","relationshipStatus":"married","togetherDuration":"3-7","hasKids":"no","conflictStyle":"talk_now","repairNeed":"plan","fightTopics":["chores"],"goal":"understand_each_other"}`

func create(t *testing.T, b *browser) map[string]any {
	t.Helper()
	return check(t, b.request("POST", "/api/v1/couples", profile), 201)
}
func current(t *testing.T, b *browser, id string) map[string]any {
	t.Helper()
	state := check(t, b.request("GET", "/api/v1/fight-sessions/"+id, ""), 200)
	return state["currentTurn"].(map[string]any)
}
func drive(t *testing.T, b *browser, id, marker string) map[string]any {
	t.Helper()
	for i := 0; i < 12; i++ {
		turn := current(t, b, id)
		if turn["type"] != "next_turn" {
			return turn
		}
		answer := "Maybe they were tired too."
		switch turn["stage"] {
		case "thermometer_start":
			answer = "8"
		case "facts":
			answer = "We argued about chores. " + marker
		case "feelings":
			answer = "I felt alone."
		case "needs":
			answer = "I wanted a clear plan."
		case "thermometer_end":
			answer = "3"
		case "ready":
			answer = "I am ready to talk"
		case "rehearsal":
			answer = "Could we talk for a few minutes?"
		}
		body, _ := json.Marshal(map[string]any{"turnIndex": turn["turnIndex"], "answerSource": "free_text", "answerText": answer})
		out := check(t, b.request("POST", "/api/v1/fight-sessions/"+id+"/turns", string(body)), 200)
		if out["type"] != "next_turn" {
			return out
		}
	}
	t.Fatal("flow did not terminate")
	return nil
}
func pay(t *testing.T, b *browser) string {
	t.Helper()
	checkout := check(t, b.request("POST", "/api/v1/subscriptions/checkout", `{"plan":"yearly"}`), 201)
	id := checkout["checkoutSessionId"].(string)
	retry := check(t, b.request("POST", "/api/v1/subscriptions/checkout", `{"plan":"yearly"}`), 201)
	if retry["checkoutSessionId"] != id {
		t.Fatal("retried checkout replaced a pending payment")
	}
	check(t, b.request("POST", "/api/v1/subscriptions/checkout", `{"plan":"monthly"}`), 409)
	if !strings.Contains(checkout["checkoutUrl"].(string), "demo=true") {
		t.Fatal("mock checkout must be marked demo")
	}
	check(t, b.request("POST", "/api/v1/subscriptions/confirm", `{"checkoutSessionId":"`+id+`"}`), 200)
	return id
}

func TestGoldenPathPrivacyPaymentJournalAndDelete(t *testing.T) {
	app, a := setup(t)
	initial := create(t, a)
	if initial["inviteUrl"] != "" || initial["subscription"] != nil || initial["defaultPlan"] != "yearly" {
		t.Fatalf("bad initial state: %v", initial)
	}
	if a.cookie == nil || !a.cookie.HttpOnly || a.cookie.SameSite != http.SameSiteLaxMode {
		t.Fatal("expected protected session cookie")
	}
	check(t, a.request("GET", "/api/v1/personality-tests/me", ""), 404)
	check(t, a.request("GET", "/api/v1/journal", ""), 402)
	person := check(t, a.request("POST", "/api/v1/personality-tests", `{"answers":[3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3]}`), 200)
	if len(person["strengths"].([]any)) != 3 || len(person["tips"].([]any)) != 2 {
		t.Fatal("incorrect personality report")
	}
	if check(t, a.request("GET", "/api/v1/couples/me", ""), 200)["personalityDone"] != true {
		t.Fatal("personality not attached to profile")
	}
	start := check(t, a.request("POST", "/api/v1/fight-sessions", `{}`), 201)
	idA := start["sessionId"].(string)
	check(t, a.request("POST", "/api/v1/fight-sessions/"+idA+"/turns", `{"answerSource":"free_text","answerText":"8"}`), 400)
	paywall := drive(t, a, idA, "PRIVATE_ALPHA_MARKER")
	if paywall["type"] != "paywall_required" {
		t.Fatalf("missing teaser paywall: %v", paywall)
	}
	preview := check(t, a.request("GET", "/api/v1/fight-sessions/"+idA+"/result", ""), 200)
	if preview["openingLine"] != "" || len(preview["locked"].([]any)) != 2 {
		t.Fatal("free result unlocked")
	}
	before := check(t, a.request("GET", "/api/v1/fight-sessions/"+idA, ""), 200)
	checkoutID := pay(t, a)
	check(t, a.request("POST", "/api/v1/subscriptions/confirm", `{"checkoutSessionId":"`+checkoutID+`"}`), 200)
	resumed := check(t, a.request("GET", "/api/v1/fight-sessions/"+idA, ""), 200)
	if resumed["sessionId"] != before["sessionId"] || resumed["stage"] != before["stage"] || len(resumed["turns"].([]any)) != len(before["turns"].([]any)) {
		t.Fatal("payment did not resume same session")
	}
	if drive(t, a, idA, "PRIVATE_ALPHA_MARKER")["type"] != "completed" {
		t.Fatal("A did not complete")
	}
	resultA := check(t, a.request("GET", "/api/v1/fight-sessions/"+idA+"/result", ""), 200)
	if resultA["openingLine"] == "" || len(resultA["locked"].([]any)) != 0 {
		t.Fatal("paid completed result still locked")
	}
	stored, _ := app.Fights.Get(idA)
	if stored.Current != nil || len(stored.Turns) != 0 {
		t.Fatal("A raw text retained after completion")
	}
	couple := check(t, a.request("GET", "/api/v1/couples/me", ""), 200)
	inviteURL, err := url.Parse(couple["inviteUrl"].(string))
	if err != nil || inviteURL.Path == "" {
		t.Fatal("no invite after A ready")
	}
	b := &browser{router: a.router}
	previewB := b.request("GET", "/api/v1"+inviteURL.Path, "")
	check(t, previewB, 200)
	if bytes.Contains(previewB.Body.Bytes(), []byte("PRIVATE_ALPHA_MARKER")) {
		t.Fatal("A private text exposed in invite")
	}
	joinBody := `{"age":"30-34","conflictStyle":"need_space","repairNeed":"being_heard"}`
	check(t, a.request("POST", "/api/v1"+inviteURL.Path+"/join", joinBody), 409)
	check(t, b.request("POST", "/api/v1"+inviteURL.Path+"/join", joinBody), 200)
	check(t, b.request("POST", "/api/v1"+inviteURL.Path+"/join", joinBody), 200)
	stranger := &browser{router: a.router}
	check(t, stranger.request("POST", "/api/v1"+inviteURL.Path+"/join", joinBody), 409)
	check(t, b.request("GET", "/api/v1/fight-sessions/"+idA+"/result", ""), 404)
	check(t, b.request("GET", "/api/v1/fight-sessions/"+idA, ""), 404)
	check(t, b.request("POST", "/api/v1/subscriptions/checkout", `{"plan":"monthly"}`), 403)
	startB := check(t, b.request("POST", "/api/v1/fight-sessions", ""), 201)
	idB := startB["sessionId"].(string)
	check(t, a.request("GET", "/api/v1/fight-sessions/"+idB, ""), 404)
	if drive(t, b, idB, "PRIVATE_BETA_MARKER")["type"] != "completed" {
		t.Fatal("B did not complete")
	}
	if check(t, a.request("GET", "/api/v1/couples/me", ""), 200)["partnerBStatus"] != "ready" {
		t.Fatal("B readiness missing")
	}
	storedB, _ := app.Fights.Get(idB)
	if storedB.Current != nil || len(storedB.Turns) != 0 {
		t.Fatal("B raw text retained")
	}
	list := a.request("GET", "/api/v1/journal", "")
	if list.Code != 200 {
		t.Fatal(list.Body.String())
	}
	var records []map[string]any
	if json.Unmarshal(list.Body.Bytes(), &records) != nil || len(records) != 1 {
		t.Fatalf("expected exactly one shared record: %s", list.Body.String())
	}
	recordID := records[0]["id"].(string)
	check(t, a.request("POST", "/api/v1/journal/"+recordID+"/rating", `{}`), 400)
	check(t, a.request("POST", "/api/v1/journal/"+recordID+"/rating", `{"rating":11}`), 400)
	nullRating := check(t, a.request("POST", "/api/v1/journal/"+recordID+"/rating", `{"rating":null}`), 200)
	if nullRating["status"] != "not_discussed" || nullRating["color"] != "gray" {
		t.Fatal("null rating not respected")
	}
	pending := check(t, a.request("POST", "/api/v1/journal/"+recordID+"/rating", `{"rating":9}`), 200)
	if pending["status"] != "pending" || pending["averageRating"] != nil {
		t.Fatal("single rating must stay pending")
	}
	rated := check(t, b.request("POST", "/api/v1/journal/"+recordID+"/rating", `{"rating":4}`), 200)
	if rated["averageRating"] != 6.5 || rated["color"] != "yellow" || rated["divergenceFlag"] != true {
		t.Fatalf("bad aggregate: %v", rated)
	}
	stats := check(t, a.request("GET", "/api/v1/journal/stats", ""), 200)
	if stats["totalFights"] != float64(1) || len(stats["averageRatingTrend"].([]any)) != 1 {
		t.Fatalf("bad stats: %v", stats)
	}
	if strings.Contains(list.Body.String(), "PRIVATE_") {
		t.Fatal("journal leaked private input")
	}
	check(t, b.request("DELETE", "/api/v1/couples/me", ""), 204)
	check(t, a.request("GET", "/api/v1/couples/me", ""), 401)
	check(t, a.request("GET", "/api/v1"+inviteURL.Path, ""), 404)
	if len(app.Couples.All())+len(app.Fights.All())+len(app.Journal.All())+len(app.Personalities.All())+len(app.Subscriptions.All()) != 0 {
		t.Fatal("Delete everything left aggregate data")
	}
	if app.Payment.VerifyCheckout(t.Context(), checkoutID, initial["coupleId"].(string), "yearly") == nil {
		t.Fatal("Delete everything retained mock payment reference")
	}
}

func TestStrictJSONSessionAndOriginBoundary(t *testing.T) {
	_, b := setup(t)
	check(t, b.request("GET", "/api/v1/couples/me", ""), 401)
	for _, body := range []string{`null`, profile + ` {}`, strings.Replace(profile, `"age":"30-34"`, `"age":"30-34","role":"B"`, 1)} {
		check(t, b.request("POST", "/api/v1/couples", body), 400)
	}
	create(t, b)
	b.cookie.Value += "tampered"
	check(t, b.request("GET", "/api/v1/couples/me", ""), 401)
	req := httptest.NewRequest("POST", "/api/v1/couples", strings.NewReader(profile))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://untrusted.example")
	w := httptest.NewRecorder()
	b.router.ServeHTTP(w, req)
	check(t, w, 403)
	req = httptest.NewRequest("OPTIONS", "/api/v1/couples", nil)
	req.Header.Set("Origin", "http://localhost:5173")
	w = httptest.NewRecorder()
	b.router.ServeHTTP(w, req)
	check(t, w, 204)
	if w.Header().Get("Access-Control-Allow-Credentials") != "true" || w.Header().Get("Access-Control-Allow-Origin") != "http://localhost:5173" {
		t.Fatal("missing credentialed CORS")
	}
	create(t, b)
	start := check(t, b.request("POST", "/api/v1/fight-sessions", `{}`), 201)
	id := start["sessionId"].(string)
	check(t, b.request("POST", "/api/v1/fight-sessions/"+id+"/turns", `{"turnIndex":0,"answerSource":"card_left","answerText":null}`), 400)
	check(t, b.request("POST", "/api/v1/fight-sessions/"+id+"/turns", `{"turnIndex":0,"answerSource":"free_text","answerText":"11"}`), 400)
	check(t, b.request("POST", "/api/v1/fight-sessions/"+id+"/turns", fmt.Sprintf(`{"turnIndex":0,"answerSource":"free_text","answerText":"%s"}`, strings.Repeat("a", 33000))), 413)
}

func TestDuplicateConcurrentAnswersAcceptExactlyOne(t *testing.T) {
	_, b := setup(t)
	create(t, b)
	start := check(t, b.request("POST", "/api/v1/fight-sessions", `{}`), 201)
	path := "/api/v1/fight-sessions/" + start["sessionId"].(string) + "/turns"
	const count = 12
	results := make(chan int, count)
	var wg sync.WaitGroup
	for i := 0; i < count; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			client := browser{router: b.router, cookie: b.cookie}
			results <- client.request("POST", path, `{"turnIndex":0,"answerSource":"free_text","answerText":"8"}`).Code
		}()
	}
	wg.Wait()
	close(results)
	accepted := 0
	for code := range results {
		if code == 200 {
			accepted++
		} else if code != 409 {
			t.Fatalf("unexpected concurrent response %d", code)
		}
	}
	if accepted != 1 {
		t.Fatalf("accepted %d answers for same turn", accepted)
	}
}
