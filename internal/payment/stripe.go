package payment

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// API fields checked against the official references on 2026-11-15:
// https://docs.stripe.com/api/checkout/sessions/create
// https://docs.stripe.com/api/checkout/sessions/object
const stripeAPIVersion = "2026-10-28.endive"

var stripeSessionID = regexp.MustCompile(`^cs_test_[A-Za-z0-9_]+$`)

type Stripe struct {
	key      string
	baseURL  string
	frontend string
	client   *http.Client
}

func NewStripe(key, frontendURL string, client *http.Client) (*Stripe, error) {
	if !strings.HasPrefix(key, "sk_test_") || len(key) <= len("sk_test_") {
		return nil, errors.New("Stripe requires a test secret key starting with sk_test_")
	}
	u, err := url.Parse(frontendURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return nil, errors.New("frontend URL must be an absolute HTTP(S) URL without credentials, query, or fragment")
	}
	configured := http.Client{Timeout: 15 * time.Second}
	if client != nil {
		configured = *client
		if configured.Timeout == 0 {
			configured.Timeout = 15 * time.Second
		}
	}
	// Never follow a redirect carrying a secret-key-authenticated request.
	configured.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &Stripe{key: key, baseURL: "https://api.stripe.com", frontend: strings.TrimRight(frontendURL, "/"), client: &configured}, nil
}

type stripeCheckout struct {
	ID                string            `json:"id"`
	URL               string            `json:"url"`
	Object            string            `json:"object"`
	LiveMode          bool              `json:"livemode"`
	ClientReferenceID string            `json:"client_reference_id"`
	Metadata          map[string]string `json:"metadata"`
	PaymentStatus     string            `json:"payment_status"`
	Status            string            `json:"status"`
	Currency          string            `json:"currency"`
	AmountTotal       int64             `json:"amount_total"`
	Mode              string            `json:"mode"`
}

func (s *Stripe) CreateCheckout(ctx context.Context, request CheckoutRequest) (Checkout, error) {
	amount, ok := Prices(request.Plan)
	if !ok {
		return Checkout{}, ErrInvalidPlan
	}
	if request.CoupleID == "" {
		return Checkout{}, ErrCheckoutMismatch
	}
	form := url.Values{
		"mode":                                   {checkoutMode(request.Plan)},
		"client_reference_id":                    {request.CoupleID},
		"metadata[coupleId]":                     {request.CoupleID},
		"metadata[plan]":                         {request.Plan},
		"success_url":                            {s.frontend + "/checkout/success?session_id={CHECKOUT_SESSION_ID}"},
		"cancel_url":                             {s.frontend + "/checkout/cancel"},
		"line_items[0][quantity]":                {"1"},
		"line_items[0][price_data][currency]":    {"usd"},
		"line_items[0][price_data][unit_amount]": {strconv.FormatInt(amount, 10)},
		"line_items[0][price_data][product_data][name]": {"Kintsugi " + request.Plan},
		"payment_method_types[0]":                       {"card"},
	}
	if request.Plan == "monthly" {
		form.Set("line_items[0][price_data][recurring][interval]", "month")
	}
	if request.Plan == "yearly" {
		form.Set("line_items[0][price_data][recurring][interval]", "year")
	}
	result, err := s.call(ctx, http.MethodPost, "/v1/checkout/sessions", strings.NewReader(form.Encode()))
	if err != nil {
		return Checkout{}, err
	}
	if result.LiveMode || !stripeSessionID.MatchString(result.ID) || result.Object != "checkout.session" {
		return Checkout{}, ErrCheckoutMismatch
	}
	checkoutURL, err := url.Parse(result.URL)
	if err != nil || checkoutURL.Scheme != "https" || checkoutURL.Host != "checkout.stripe.com" || checkoutURL.User != nil {
		return Checkout{}, ErrCheckoutMismatch
	}
	return Checkout{CheckoutSessionID: result.ID, CheckoutURL: result.URL}, nil
}

func (s *Stripe) VerifyCheckout(ctx context.Context, sessionID, coupleID, plan string) error {
	amount, ok := Prices(plan)
	if !ok {
		return ErrInvalidPlan
	}
	if !stripeSessionID.MatchString(sessionID) || coupleID == "" {
		return ErrCheckoutMismatch
	}
	result, err := s.call(ctx, http.MethodGet, "/v1/checkout/sessions/"+url.PathEscape(sessionID), nil)
	if err != nil {
		return err
	}
	if result.ID != sessionID || result.Object != "checkout.session" || result.LiveMode || result.ClientReferenceID != coupleID || result.Metadata["coupleId"] != coupleID || result.Metadata["plan"] != plan || result.Currency != "usd" || result.AmountTotal != amount || result.Mode != checkoutMode(plan) {
		return ErrCheckoutMismatch
	}
	if result.PaymentStatus != "paid" || result.Status != "complete" {
		return ErrCheckoutNotPaid
	}
	return nil
}

func checkoutMode(plan string) string {
	if plan == "program" {
		return "payment"
	}
	return "subscription"
}

func (s *Stripe) call(ctx context.Context, method, path string, body io.Reader) (stripeCheckout, error) {
	request, err := http.NewRequestWithContext(ctx, method, s.baseURL+path, body)
	if err != nil {
		return stripeCheckout{}, fmt.Errorf("%w: invalid request", ErrProviderUnavailable)
	}
	request.SetBasicAuth(s.key, "")
	request.Header.Set("Stripe-Version", stripeAPIVersion)
	if body != nil {
		request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	response, err := s.client.Do(request)
	if err != nil {
		if ctx.Err() != nil {
			return stripeCheckout{}, ctx.Err()
		}
		return stripeCheckout{}, fmt.Errorf("%w: request failed", ErrProviderUnavailable)
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		return stripeCheckout{}, ErrCheckoutNotFound
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return stripeCheckout{}, fmt.Errorf("%w: HTTP %d", ErrProviderUnavailable, response.StatusCode)
	}
	// Do not echo provider response bodies or request details into application logs.
	const maximumResponse = 1 << 20
	bytes, err := io.ReadAll(io.LimitReader(response.Body, maximumResponse+1))
	if err != nil || len(bytes) > maximumResponse {
		return stripeCheckout{}, fmt.Errorf("%w: invalid response", ErrProviderUnavailable)
	}
	var result stripeCheckout
	if err := json.Unmarshal(bytes, &result); err != nil {
		return stripeCheckout{}, fmt.Errorf("%w: invalid response", ErrProviderUnavailable)
	}
	return result, nil
}

// DeleteCouple is intentionally a no-op: this adapter stores no local records.
// Deleting app data does not cancel a Stripe subscription or remove Stripe data.
func (*Stripe) DeleteCouple(string) {}
