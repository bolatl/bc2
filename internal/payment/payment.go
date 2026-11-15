// Package payment offers a local demo provider and verified Stripe test checkout.
package payment

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
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
	VerifyCheckout(ctx context.Context, sessionID, coupleID, plan string) error
}

type CheckoutRequest struct {
	CoupleID string
	Plan     string
}

type Checkout struct {
	CheckoutURL       string `json:"checkoutUrl"`
	CheckoutSessionID string `json:"checkoutSessionId"`
}

// Prices returns the price in integer US cents, never floating-point currency.
func Prices(plan string) (int64, bool) {
	switch plan {
	case "monthly":
		return 1499, true
	case "yearly":
		return 9900, true
	case "program":
		return 14900, true
	default:
		return 0, false
	}
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
	if _, ok := Prices(request.Plan); !ok {
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
	m.mu.Lock()
	m.sessions[id] = request
	m.mu.Unlock()
	return Checkout{CheckoutSessionID: id, CheckoutURL: m.baseURL + "/checkout/demo?session_id=" + url.QueryEscape(id) + "&demo=true"}, nil
}

func (m *Mock) VerifyCheckout(ctx context.Context, sessionID, coupleID, plan string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if _, ok := Prices(plan); !ok {
		return ErrInvalidPlan
	}
	m.mu.Lock()
	request, exists := m.sessions[sessionID]
	m.mu.Unlock()
	if !exists {
		return ErrCheckoutNotFound
	}
	if request.CoupleID != coupleID || request.Plan != plan {
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
