package service

import (
	"context"
	"lovelab/internal/dto"
	"lovelab/internal/model"
	"lovelab/internal/payment"
)

func (a *App) Checkout(ctx context.Context, actor model.Actor, plan string) (dto.CreateCheckoutResponse, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if _, err := a.couple(actor); err != nil {
		return dto.CreateCheckoutResponse{}, err
	}
	if actor.PartnerRole != "A" {
		return dto.CreateCheckoutResponse{}, fail(403, "forbidden", "The initiating partner manages the couple subscription.")
	}
	if _, ok := payment.Prices(plan); !ok {
		return dto.CreateCheckoutResponse{}, invalid("Choose monthly, yearly, or program.")
	}
	if a.active(actor.CoupleID) {
		return dto.CreateCheckoutResponse{}, conflict("The couple subscription is already active.")
	}
	if pending, ok := a.Subscriptions.Get(actor.CoupleID); ok && pending.Status == "pending" {
		if pending.Plan != plan {
			return dto.CreateCheckoutResponse{}, conflict("A checkout for another plan is already pending.")
		}
		return dto.CreateCheckoutResponse{CheckoutURL: pending.CheckoutURL, CheckoutSessionID: pending.CheckoutSessionID}, nil
	}
	result, err := a.Payment.CreateCheckout(ctx, payment.CheckoutRequest{CoupleID: actor.CoupleID, Plan: plan})
	if err != nil {
		return dto.CreateCheckoutResponse{}, fail(502, "payment_unavailable", "Checkout is temporarily unavailable.")
	}
	a.Subscriptions.Put(actor.CoupleID, model.Subscription{CoupleID: actor.CoupleID, Plan: plan, Status: "pending", CheckoutSessionID: result.CheckoutSessionID, CheckoutURL: result.CheckoutURL})
	return dto.CreateCheckoutResponse{CheckoutURL: result.CheckoutURL, CheckoutSessionID: result.CheckoutSessionID}, nil
}
func (a *App) ConfirmCheckout(ctx context.Context, actor model.Actor, id string) (dto.SubscriptionResponse, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if _, err := a.couple(actor); err != nil {
		return dto.SubscriptionResponse{}, err
	}
	if actor.PartnerRole != "A" {
		return dto.SubscriptionResponse{}, fail(403, "forbidden", "The initiating partner manages the couple subscription.")
	}
	if id == "" {
		return dto.SubscriptionResponse{}, invalid("checkoutSessionId is required.")
	}
	s, ok := a.Subscriptions.Get(actor.CoupleID)
	if !ok || s.CheckoutSessionID != id {
		return dto.SubscriptionResponse{}, notFound()
	}
	if s.Status != "active" {
		if err := a.Payment.VerifyCheckout(ctx, id, actor.CoupleID, s.Plan); err != nil {
			return dto.SubscriptionResponse{}, fail(409, "payment_unconfirmed", "Checkout has not been verified as paid.")
		}
		now := a.Now()
		s.Status = "active"
		s.ActivatedAt = &now
		a.Subscriptions.Put(actor.CoupleID, s)
		for _, f := range a.Fights.All() {
			if f.CoupleID == actor.CoupleID && contains(f.Status, "in_progress", "awaiting_payment") {
				f.Tier = "full"
				if f.Status == "awaiting_payment" {
					f.Status = "in_progress"
				}
				a.Fights.Put(f.ID, f)
			}
		}
	}
	return dto.SubscriptionResponse{Plan: s.Plan, Status: s.Status, ActivatedAt: s.ActivatedAt}, nil
}
func (a *App) SubscriptionMe(actor model.Actor) (dto.SubscriptionResponse, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	c, err := a.couple(actor)
	if err != nil {
		return dto.SubscriptionResponse{}, err
	}
	s, ok := a.Subscriptions.Get(actor.CoupleID)
	if !ok && a.Config.DisablePaywall {
		return dto.SubscriptionResponse{Plan: defaultPlan(c), Status: "active"}, nil
	}
	if !ok {
		return dto.SubscriptionResponse{Plan: defaultPlan(c), Status: "none"}, nil
	}
	return dto.SubscriptionResponse{Plan: s.Plan, Status: s.Status, ActivatedAt: s.ActivatedAt}, nil
}
