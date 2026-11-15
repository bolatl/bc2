import type { PlanOption } from '../api/types';

type SavedCheckout = { coupleId: string; sessionId: string | null; checkoutSessionId: string; plan: string };
const checkoutKey = 'lovelab.checkout';

// Only navigation references belong in storage. Card fields never leave the form.
export function saveCheckout(value: SavedCheckout) {
  try { sessionStorage.setItem(checkoutKey, JSON.stringify(value)); } catch { /* The server can restore the pending checkout. */ }
}

export function readCheckout(coupleId: string): SavedCheckout | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(checkoutKey) || 'null') as SavedCheckout | null;
    return value?.coupleId === coupleId && typeof value.checkoutSessionId === 'string' && typeof value.plan === 'string'
      && (value.sessionId === null || typeof value.sessionId === 'string') ? value : null;
  } catch { return null; }
}

export function clearCheckout() {
  try { sessionStorage.removeItem(checkoutKey); } catch { /* Storage may be disabled. */ }
}

export const fallbackPlans: PlanOption[] = [
  { plan: 'yearly', priceUsd: 199, isDefault: true },
  { plan: 'monthly', priceUsd: 19.99, isDefault: false },
  { plan: 'date_night', priceUsd: 69, isDefault: false },
];

export const planCopy: Record<string, { title: string; period: string; description: string }> = {
  monthly: { title: 'Kintsugi', period: '/ month', description: 'One plan for two: $9.99 per person per month.' },
  yearly: { title: 'Premium', period: '/ year', description: 'Date night, SOS mode, unlimited sessions.' },
  date_night: { title: 'Date Night', period: 'one-time', description: 'A one-time purchase for both of you.' },
  // Older paid accounts and already-open checkouts remain supported.
  premium_monthly: { title: 'Premium', period: '/ month', description: 'Existing monthly Premium plan.' },
  program: { title: '8-week program', period: 'one-time', description: 'Eight weeks to prepare together' },
};

export function planPrice(plan: string, plans = fallbackPlans) {
  return plans.find(option => option.plan === plan)?.priceUsd ?? (plan === 'program' ? 149 : plan === 'premium_monthly' ? 29.99 : 0);
}
