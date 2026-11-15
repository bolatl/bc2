package handler

import (
	"testing"
)

func TestCheckoutDateNightIsOneStandaloneOption(t *testing.T) {
	_, a := setup(t)
	create(t, a)
	for _, body := range []string{
		`{"plan":"program"}`,
		`{"plan":"premium_monthly"}`,
		`{"plan":"premium_monthly","addOns":["date_night"]}`,
		`{"plan":"monthly","addOns":["date_night"]}`,
		`{"plan":"date_night","addOns":["date_night"]}`,
		`{"plan":"monthly","addOns":["program"]}`,
		`{"plan":"monthly","addOns":["unknown"]}`,
		`{"plan":"monthly","addOns":["date_night","date_night"]}`,
	} {
		check(t, a.request("POST", "/api/v1/subscriptions/checkout", body), 400)
	}
	const basket = `{"plan":"date_night"}`
	checkout := check(t, a.request("POST", "/api/v1/subscriptions/checkout", basket), 201)
	if checkout["amountUsd"] != float64(69) || checkout["addOns"] != nil {
		t.Fatalf("wrong single-option price or selection: %v", checkout)
	}
	id := checkout["checkoutSessionId"].(string)
	retry := check(t, a.request("POST", "/api/v1/subscriptions/checkout", basket), 201)
	if retry["checkoutSessionId"] != id || retry["amountUsd"] != checkout["amountUsd"] {
		t.Fatalf("checkout retry changed the purchase: %v", retry)
	}
	check(t, a.request("POST", "/api/v1/subscriptions/checkout", `{"plan":"monthly"}`), 409)
	check(t, a.request("POST", "/api/v1/subscriptions/checkout", `{"plan":"yearly","addOns":["date_night"]}`), 400)
	other := &browser{router: a.router}
	create(t, other)
	confirm := `{"checkoutSessionId":"` + id + `"}`
	check(t, other.request("POST", "/api/v1/subscriptions/confirm", confirm), 404)
	paid := check(t, a.request("POST", "/api/v1/subscriptions/confirm", confirm), 200)
	if paid["plan"] != "date_night" || paid["status"] != "active" || paid["addOns"] != nil {
		t.Fatalf("Date Night did not activate account access: %v", paid)
	}
	check(t, a.request("POST", "/api/v1/subscriptions/confirm", confirm), 200)
	view := check(t, a.request("GET", "/api/v1/couples/me", ""), 200)["subscription"].(map[string]any)
	if view["plan"] != "date_night" || view["addOns"] != nil {
		t.Fatalf("couple response lost the chosen option: %v", view)
	}
	check(t, a.request("POST", "/api/v1/subscriptions/checkout", basket), 409)
}
