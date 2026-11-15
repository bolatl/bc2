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
  { plan: 'yearly', priceUsd: 99, isDefault: false },
  { plan: 'program', priceUsd: 149, isDefault: false },
  { plan: 'monthly', priceUsd: 14.99, isDefault: false },
];

export const planCopy: Record<string, { title: string; period: string; description: string }> = {
  monthly: { title: 'Monthly', period: '/ month', description: 'One month for both of you' },
  yearly: { title: 'Yearly', period: '/ year', description: '$8.25 per month, billed yearly' },
  program: { title: '8-week program', period: 'one-time', description: 'Eight weeks to prepare together' },
};
