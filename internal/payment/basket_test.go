package payment

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestMockAcceptsDateNightAloneAndRejectsCombinedOptions(t *testing.T) {
	client := NewMock("http://localhost:5173")
	checkout, err := client.CreateCheckout(context.Background(), CheckoutRequest{CoupleID: "couple-a", Plan: "date_night"})
	if err != nil {
		t.Fatal(err)
	}
	if err := client.VerifyCheckout(context.Background(), checkout.CheckoutSessionID, "couple-a", "date_night"); err != nil {
		t.Fatal(err)
	}
	if err := client.VerifyCheckout(context.Background(), checkout.CheckoutSessionID, "couple-a", "monthly"); !errors.Is(err, ErrCheckoutMismatch) {
		t.Fatalf("changed basket accepted: %v", err)
	}
	if err := client.VerifyCheckout(context.Background(), checkout.CheckoutSessionID, "couple-b", "date_night"); !errors.Is(err, ErrCheckoutMismatch) {
		t.Fatalf("wrong owner accepted: %v", err)
	}
	for _, request := range []CheckoutRequest{
		{CoupleID: "couple-a", Plan: "program"},
		{CoupleID: "couple-a", Plan: "premium_monthly"},
		{CoupleID: "couple-a", Plan: "monthly", AddOns: []string{"date_night"}},
		{CoupleID: "couple-a", Plan: "date_night", AddOns: []string{"date_night"}},
		{CoupleID: "couple-a", Plan: "monthly", AddOns: []string{"program"}},
		{CoupleID: "couple-a", Plan: "monthly", AddOns: []string{"date_night", "date_night"}},
	} {
		if _, err := client.CreateCheckout(context.Background(), request); !errors.Is(err, ErrInvalidPlan) {
			t.Fatalf("invalid basket accepted: %+v %v", request, err)
		}
	}
}

func TestStripeVerifiesStandaloneDateNightAmountAndRejectsCombinedMetadata(t *testing.T) {
	for _, tc := range []struct {
		name     string
		amount   int64
		metadata string
		want     error
	}{
		{"paid", 6900, "", nil},
		{"wrong-total", 8899, "", ErrCheckoutMismatch},
		{"combined-metadata", 6900, "date_night", ErrCheckoutMismatch},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				value := paidCheckout()
				value.Metadata["plan"], value.Mode = "date_night", "payment"
				value.AmountTotal, value.Metadata["addOns"] = tc.amount, tc.metadata
				json.NewEncoder(w).Encode(value)
			}))
			defer server.Close()
			client, _ := NewStripe("sk_test_example", "http://localhost:5173", server.Client())
			client.baseURL = server.URL
			if err := client.VerifyCheckout(context.Background(), "cs_test_example", "couple-a", "date_night"); !errors.Is(err, tc.want) {
				t.Fatalf("got %v, want %v", err, tc.want)
			}
		})
	}
}

func TestRetiredPlansRemainVerifiableButCannotBeSold(t *testing.T) {
	for _, legacy := range []struct {
		plan, mode string
		amount     int64
	}{{"program", "payment", 14900}, {"premium_monthly", "subscription", 2999}} {
		t.Run(legacy.plan, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				value := paidCheckout()
				value.Metadata["plan"], value.AmountTotal, value.Mode = legacy.plan, legacy.amount, legacy.mode
				json.NewEncoder(w).Encode(value)
			}))
			defer server.Close()
			client, _ := NewStripe("sk_test_example", "http://localhost:5173", server.Client())
			client.baseURL = server.URL
			if err := client.VerifyCheckout(context.Background(), "cs_test_example", "couple-a", legacy.plan); err != nil {
				t.Fatal(err)
			}
			if _, err := client.CreateCheckout(context.Background(), CheckoutRequest{CoupleID: "couple-a", Plan: legacy.plan}); !errors.Is(err, ErrInvalidPlan) {
				t.Fatalf("new retired-plan purchase allowed: %v", err)
			}
		})
	}
}
