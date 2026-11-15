package handler

import "testing"

func TestConversationListRouteRequiresSessionAndKeepsHistoriesSeparate(t *testing.T) {
	_, first := setup(t)
	check(t, first.request("GET", "/api/v1/fight-sessions", ""), 401)
	me := create(t, first)
	if me["ownProfile"] == nil || me["partnerStatus"] != "not_started" {
		t.Fatal("bootstrap does not include own profile and partner status")
	}
	fight := check(t, first.request("POST", "/api/v1/fight-sessions", "{}"), 201)
	list := check(t, first.request("GET", "/api/v1/fight-sessions", ""), 200)
	rows := list["conversations"].([]any)
	if len(rows) != 1 || rows[0].(map[string]any)["sessionId"] != fight["sessionId"] || list["canStartNew"] != false {
		t.Fatal("new unpaid conversation missing from owner's history")
	}
	other := &browser{router: first.router}
	create(t, other)
	otherList := check(t, other.request("GET", "/api/v1/fight-sessions", ""), 200)
	if len(otherList["conversations"].([]any)) != 0 {
		t.Fatal("another browser received a different couple's history")
	}
}
