package payment

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestMockOnlyConfirmsIssuedCheckoutForSameCoupleAndPlan(t *testing.T) {
	client := NewMock("http://localhost:3000/")
	ctx := context.Background()
	checkout, err := client.CreateCheckout(ctx, CheckoutRequest{CoupleID: "couple-a", Plan: "monthly"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(checkout.CheckoutSessionID, "cs_mock_") {
		t.Fatal(checkout)
	}
	destination, err := url.Parse(checkout.CheckoutURL)
	if err != nil {
		t.Fatal(err)
	}
	if destination.Scheme != "http" || destination.Host != "localhost:3000" || destination.Path != "/checkout/demo" || destination.Query().Get("session_id") != checkout.CheckoutSessionID || destination.Query().Get("demo") != "true" {
		t.Fatalf("checkout must open the demo form for the issued session: %s", checkout.CheckoutURL)
	}
	if err := client.VerifyCheckout(ctx, checkout.CheckoutSessionID, "couple-a", "monthly"); err != nil {
		t.Fatal(err)
	}
	if err := client.VerifyCheckout(ctx, checkout.CheckoutSessionID, "couple-b", "monthly"); !errors.Is(err, ErrCheckoutMismatch) {
		t.Fatalf("cross-couple checkout: %v", err)
	}
	if err := client.VerifyCheckout(ctx, checkout.CheckoutSessionID, "couple-a", "yearly"); !errors.Is(err, ErrCheckoutMismatch) {
		t.Fatalf("wrong plan: %v", err)
	}
	if err := client.VerifyCheckout(ctx, "cs_mock_forged", "couple-a", "monthly"); !errors.Is(err, ErrCheckoutNotFound) {
		t.Fatalf("forged checkout: %v", err)
	}
	client.DeleteCouple("couple-a")
	if err := client.VerifyCheckout(ctx, checkout.CheckoutSessionID, "couple-a", "monthly"); !errors.Is(err, ErrCheckoutNotFound) {
		t.Fatal("retained deleted couple")
	}
}

func TestStripeCreateUsesServerControlledPrice(t *testing.T) {
	for _, tt := range []struct{ plan, amount, mode, interval string }{{"monthly", "1499", "subscription", "month"}, {"yearly", "9900", "subscription", "year"}, {"program", "14900", "payment", ""}} {
		t.Run(tt.plan, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodPost || r.URL.Path != "/v1/checkout/sessions" {
					t.Errorf("unexpected request %s %s", r.Method, r.URL)
				}
				user, _, ok := r.BasicAuth()
				if !ok || user != "sk_test_example" {
					t.Error("missing authentication")
				}
				if r.Header.Get("Stripe-Version") != stripeAPIVersion {
					t.Error("missing pinned API version")
				}
				if err := r.ParseForm(); err != nil {
					t.Error(err)
				}
				for key, want := range map[string]string{
					"mode": tt.mode, "client_reference_id": "couple-a", "metadata[coupleId]": "couple-a", "metadata[plan]": tt.plan,
					"line_items[0][price_data][unit_amount]": tt.amount, "line_items[0][price_data][currency]": "usd",
					"line_items[0][price_data][recurring][interval]": tt.interval,
					"success_url": "http://localhost:3000/checkout/success?session_id={CHECKOUT_SESSION_ID}",
				} {
					if got := r.Form.Get(key); got != want {
						t.Errorf("%s = %q; want %q", key, got, want)
					}
				}
				json.NewEncoder(w).Encode(stripeCheckout{ID: "cs_test_example", Object: "checkout.session", URL: "https://checkout.stripe.com/c/pay/cs_test_example"})
			}))
			defer server.Close()
			client, _ := NewStripe("sk_test_example", "http://localhost:3000", server.Client())
			client.baseURL = server.URL
			checkout, err := client.CreateCheckout(context.Background(), CheckoutRequest{CoupleID: "couple-a", Plan: tt.plan})
			if err != nil || checkout.CheckoutSessionID != "cs_test_example" {
				t.Fatalf("%+v: %v", checkout, err)
			}
		})
	}
}

func paidCheckout() stripeCheckout {
	return stripeCheckout{ID: "cs_test_example", Object: "checkout.session", ClientReferenceID: "couple-a", Metadata: map[string]string{"coupleId": "couple-a", "plan": "monthly"}, PaymentStatus: "paid", Status: "complete", Currency: "usd", AmountTotal: 1499, Mode: "subscription"}
}

func TestStripeVerifyRequiresPaymentOwnershipAmountAndTestMode(t *testing.T) {
	for _, tt := range []struct {
		name   string
		mutate func(*stripeCheckout)
		want   error
	}{
		{"paid", func(*stripeCheckout) {}, nil},
		{"unpaid", func(c *stripeCheckout) { c.PaymentStatus = "unpaid" }, ErrCheckoutNotPaid},
		{"not_complete", func(c *stripeCheckout) { c.Status = "open" }, ErrCheckoutNotPaid},
		{"live", func(c *stripeCheckout) { c.LiveMode = true }, ErrCheckoutMismatch},
		{"wrong_id", func(c *stripeCheckout) { c.ID = "cs_test_another" }, ErrCheckoutMismatch},
		{"wrong_owner", func(c *stripeCheckout) { c.ClientReferenceID = "couple-b" }, ErrCheckoutMismatch},
		{"wrong_metadata_owner", func(c *stripeCheckout) { c.Metadata["coupleId"] = "couple-b" }, ErrCheckoutMismatch},
		{"wrong_plan", func(c *stripeCheckout) { c.Metadata["plan"] = "yearly" }, ErrCheckoutMismatch},
		{"wrong_amount", func(c *stripeCheckout) { c.AmountTotal = 1 }, ErrCheckoutMismatch},
		{"wrong_currency", func(c *stripeCheckout) { c.Currency = "eur" }, ErrCheckoutMismatch},
		{"wrong_mode", func(c *stripeCheckout) { c.Mode = "payment" }, ErrCheckoutMismatch},
	} {
		t.Run(tt.name, func(t *testing.T) {
			value := paidCheckout()
			tt.mutate(&value)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodGet || r.URL.Path != "/v1/checkout/sessions/cs_test_example" {
					t.Errorf("unexpected request: %s %s", r.Method, r.URL)
				}
				json.NewEncoder(w).Encode(value)
			}))
			defer server.Close()
			client, _ := NewStripe("sk_test_example", "http://localhost:3000", server.Client())
			client.baseURL = server.URL
			if err := client.VerifyCheckout(context.Background(), "cs_test_example", "couple-a", "monthly"); !errors.Is(err, tt.want) {
				t.Fatalf("got %v; want %v", err, tt.want)
			}
		})
	}
}

func TestStripeRejectsLiveKeyForgedIDsAndProviderErrors(t *testing.T) {
	if _, err := NewStripe("sk_live_example", "http://localhost:3000", nil); err == nil {
		t.Fatal("accepted live key")
	}
	if _, err := NewStripe("sk_test_example", "javascript:alert(1)", nil); err == nil {
		t.Fatal("accepted invalid frontend URL")
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		w.Write([]byte("secret provider response with sk_test_example"))
	}))
	defer server.Close()
	client, _ := NewStripe("sk_test_example", "http://localhost:3000", server.Client())
	client.baseURL = server.URL
	if err := client.VerifyCheckout(context.Background(), "cs_live_example", "couple-a", "monthly"); !errors.Is(err, ErrCheckoutMismatch) {
		t.Fatal(err)
	}
	err := client.VerifyCheckout(context.Background(), "cs_test_example", "couple-a", "monthly")
	if !errors.Is(err, ErrProviderUnavailable) || strings.Contains(err.Error(), "sk_test_example") {
		t.Fatalf("unsafe error: %v", err)
	}
}

func TestStripeDoesNotFollowRedirects(t *testing.T) {
	followed := false
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { followed = true }))
	defer target.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusTemporaryRedirect)
	}))
	defer server.Close()
	client, _ := NewStripe("sk_test_example", "http://localhost:3000", server.Client())
	client.baseURL = server.URL
	err := client.VerifyCheckout(context.Background(), "cs_test_example", "couple-a", "monthly")
	if !errors.Is(err, ErrProviderUnavailable) || followed {
		t.Fatalf("redirect followed=%v; err=%v", followed, err)
	}
}
