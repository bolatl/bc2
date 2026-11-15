// Package payment offers a local demo provider and verified Stripe test checkout.
package payment

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"slices"
	"strings"
	"sync"
)

var (
	ErrInvalidPlan         = errors.New("invalid payment plan")
	ErrCheckoutNotFound    = errors.New("checkout session not found")
	ErrCheckoutNotPaid     = errors.New("checkout is not complete and paid")
	ErrCheckoutMismatch    = errors.New("checkout does not match this couple and plan")
	ErrProviderUnavailable = errors.New("payment provider unavailable")
)

type Client interface {
	CreateCheckout(context.Context, CheckoutRequest) (Checkout, error)
	VerifyCheckout(ctx context.Context, sessionID, coupleID, plan string, addOns ...string) error
}

type CheckoutRequest struct {
	CoupleID string
	Plan     string
	AddOns   []string
}

type Checkout struct {
	CheckoutURL       string `json:"checkoutUrl"`
	CheckoutSessionID string `json:"checkoutSessionId"`
}

// Prices returns the price in integer US cents, never floating-point currency.
func Prices(plan string) (int64, bool) {
	switch plan {
	case "monthly":
		return 1999, true
	case "yearly":
		return 19900, true
	case "date_night":
		return 6900, true
	case "premium_monthly":
		return 2999, true
	case "program":
		return 14900, true
	default:
		return 0, false
	}
}

func IsCheckoutPlan(plan string) bool {
	return plan == "monthly" || plan == "yearly" || plan == "date_night"
}

// CheckoutAmount accepts retired plans only for verifying or resuming an
// existing checkout. New checkouts require a currently offered plan.
func CheckoutAmount(plan string, addOns ...string) (int64, bool) {
	if len(addOns) != 0 {
		return 0, false
	}
	return Prices(plan)
}

type Mock struct {
	mu       sync.Mutex
	baseURL  string
	sessions map[string]CheckoutRequest
}

// NewMock simulates payment success on verification. It must be labelled as a
// demo in the UI and is never a substitute for Stripe verification in test mode.
func NewMock(frontendURL string) *Mock {
	return &Mock{baseURL: strings.TrimRight(frontendURL, "/"), sessions: make(map[string]CheckoutRequest)}
}

func (m *Mock) CreateCheckout(ctx context.Context, request CheckoutRequest) (Checkout, error) {
	if err := ctx.Err(); err != nil {
		return Checkout{}, err
	}
	if _, ok := CheckoutAmount(request.Plan, request.AddOns...); !ok || !IsCheckoutPlan(request.Plan) {
		return Checkout{}, ErrInvalidPlan
	}
	if request.CoupleID == "" {
		return Checkout{}, ErrCheckoutMismatch
	}
	var nonce [24]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return Checkout{}, fmt.Errorf("generate checkout id: %w", err)
	}
	id := "cs_mock_" + hex.EncodeToString(nonce[:])
	request.AddOns = slices.Clone(request.AddOns)
	m.mu.Lock()
	m.sessions[id] = request
	m.mu.Unlock()
	return Checkout{CheckoutSessionID: id, CheckoutURL: m.baseURL + "/checkout/demo?session_id=" + url.QueryEscape(id) + "&demo=true"}, nil
}

func (m *Mock) VerifyCheckout(ctx context.Context, sessionID, coupleID, plan string, addOns ...string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if _, ok := CheckoutAmount(plan, addOns...); !ok {
		return ErrInvalidPlan
	}
	m.mu.Lock()
	request, exists := m.sessions[sessionID]
	m.mu.Unlock()
	if !exists {
		return ErrCheckoutNotFound
	}
	if request.CoupleID != coupleID || request.Plan != plan || !slices.Equal(request.AddOns, addOns) {
		return ErrCheckoutMismatch
	}
	return nil
}

// DeleteCouple removes local checkout references for Delete everything. The
// Stripe adapter keeps no local state; provider records follow Stripe retention.
func (m *Mock) DeleteCouple(coupleID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for id, request := range m.sessions {
		if request.CoupleID == coupleID {
			delete(m.sessions, id)
		}
	}
}
