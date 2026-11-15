import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Check, HeartHandshake, LoaderCircle, ShieldCheck } from 'lucide-react';
import { api, errorMessage } from '../api/client';
import type { Checkout, Subscription } from '../api/types';
import { useSession } from '../app/session';
import { Button, Loading, Notice, Page } from '../components/ui';
import { clearCheckout, fallbackPlans, planCopy, readCheckout, saveCheckout } from './checkout-state';
import '../styles/demo-checkout.css';

type CardFields = { name: string; number: string; expiry: string; cvc: string };
type FieldErrors = Partial<Record<keyof CardFields, string>>;
const emptyFields: CardFields = { name: '', number: '', expiry: '', cvc: '' };
function demoFields(): CardFields {
  return { name: 'Demo User', number: '4242 4242 4242 4242', expiry: `12/${String((new Date().getFullYear() + 3) % 100).padStart(2, '0')}`, cvc: '123' };
}

function validate(fields: CardFields): FieldErrors {
  const errors: FieldErrors = {};
  if (!fields.name.trim()) errors.name = 'Enter a test cardholder name.';
  if (fields.number.replace(/\s/g, '') !== '4242424242424242') errors.number = 'Use the demo card: 4242 4242 4242 4242.';
  const match = /^(\d{2})\s*\/\s*(\d{2})$/.exec(fields.expiry);
  const now = new Date();
  if (!match || +match[1] < 1 || +match[1] > 12
    || (2000 + +match[2]) * 12 + +match[1] < now.getFullYear() * 12 + now.getMonth() + 1) {
    errors.expiry = 'Enter a valid expiry in MM/YY format, this month or later.';
  }
  if (!/^\d{3}$/.test(fields.cvc)) errors.cvc = 'Enter any three digits for this demo.';
  return errors;
}

export function DemoCheckoutPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const checkoutId = params.get('session_id') || '';
  const { couple, refresh } = useSession();
  const cache = useQueryClient();
  const coupleId = couple?.coupleId;
  const role = couple?.partnerRole;
  const currentSessionId = couple?.currentSessionId ?? null;
  const [phase, setPhase] = useState<'loading' | 'ready' | 'paid' | 'error'>('loading');
  const [plan, setPlan] = useState('');
  const [fields, setFields] = useState<CardFields>(demoFields);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const form = useRef<HTMLFormElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = useRef(false);
  const operation = useRef<AbortController | null>(null);
  const continuation = useRef(currentSessionId);

  useEffect(() => {
    const controller = new AbortController();
    operation.current = controller;
    pending.current = false;
    setPhase('loading'); setError(null); setFields(demoFields()); setErrors({}); setBusy(false);
    if (!coupleId || role !== 'A') return () => controller.abort();
    const saved = readCheckout(coupleId);
    continuation.current = saved?.checkoutSessionId === checkoutId ? saved.sessionId : currentSessionId;
    async function load() {
      try {
        if (!/^cs_mock_[a-f0-9]{48}$/.test(checkoutId)) throw new Error('This demo checkout link is invalid. Return to your plans to open a new checkout.');
        const subscription = await api<Subscription>('/subscriptions/me', undefined, { signal: controller.signal });
        if (!fallbackPlans.some(item => item.plan === subscription.plan)) throw new Error('This plan is not available. Return to your plans.');
        if (controller.signal.aborted) return;
        setPlan(subscription.plan);
        if (subscription.status === 'active') { setPhase('paid'); return; }
        if (subscription.status !== 'pending') throw new Error('There is no pending checkout. Choose your plan first.');
        // The backend restores the pending checkout and its plan; URL parameters
        // and browser storage are never trusted to choose a different purchase.
        const checkout = await api<Checkout>('/subscriptions/checkout', { plan: subscription.plan }, { signal: controller.signal });
        if (checkout.checkoutSessionId !== checkoutId) throw new Error('This checkout does not belong to your current session. Return to your plans.');
        if (controller.signal.aborted) return;
        saveCheckout({ coupleId: coupleId!, checkoutSessionId: checkoutId, sessionId: continuation.current, plan: subscription.plan });
        setPhase('ready');
      } catch (reason) {
        if (!controller.signal.aborted) { setError(errorMessage(reason)); setPhase('error'); }
      }
    }
    void load();
    return () => controller.abort();
  }, [checkoutId, coupleId, role, currentSessionId, attempt]);

  useEffect(() => {
    const element = dialog.current;
    if (phase !== 'ready' || !element) return;
    element.showModal();
    element.querySelector<HTMLHeadingElement>('h2')?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { element.close(); document.body.style.overflow = previousOverflow; };
  }, [phase]);

  function update(field: keyof CardFields, value: string) {
    setFields(previous => ({ ...previous, [field]: value }));
    setErrors(previous => ({ ...previous, [field]: undefined }));
    setError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || phase !== 'ready') return;
    const invalid = validate(fields);
    setErrors(invalid);
    const first = Object.keys(invalid)[0];
    if (first) { form.current?.querySelector<HTMLInputElement>(`[name="${first}"]`)?.focus(); return; }
    const controller = operation.current;
    if (!controller || controller.signal.aborted) return;
    pending.current = true; setBusy(true); setError(null);
    try {
      // Deliberately send ONLY the issued checkout reference. The name, number,
      // expiry and CVC are UI-only demo inputs, never sent or persisted.
      const subscription = await api<Subscription>('/subscriptions/confirm', { checkoutSessionId: checkoutId }, { signal: controller.signal });
      if (subscription.status !== 'active') throw new Error('Your plan is not active yet. Please try again.');
      if (controller.signal.aborted) return;
      setFields(emptyFields); setPhase('paid'); clearCheckout();
      // Confirmation is authoritative even if the follow-up refresh fails.
      void refresh().catch(() => undefined);
      void cache.invalidateQueries();
    } catch (reason) {
      if (!controller.signal.aborted) setError(errorMessage(reason));
    } finally {
      if (!controller.signal.aborted) { pending.current = false; setBusy(false); }
    }
  }

  const returnToPlans = continuation.current ? `/paywall?sessionId=${encodeURIComponent(continuation.current)}` : '/paywall';
  if (role === 'B') return <Page title="Your partner manages your shared plan."><p className="lead">One plan covers both of you. Your partner can finish this demo checkout.</p><Link className="text-link" to="/home">Return home</Link></Page>;
  if (phase === 'loading') return <Loading label="Opening your demo checkout…" />;
  if (phase === 'error') return <Page title="Let’s reopen your checkout."><Notice kind="error">{error}</Notice><div className="actions"><Button onClick={() => setAttempt(value => value + 1)}>Try again</Button><Link className="text-link" to={returnToPlans}>Return to plans</Link></div></Page>;
  const copy = planCopy[plan];
  const amount = fallbackPlans.find(item => item.plan === plan)?.priceUsd;
  if (phase === 'paid') return <Page eyebrow="Demo checkout complete" title="Your plan is active." description="Both of you now have full access. No payment was taken." layout="wide" className="demo-checkout-page">
    <section className="demo-checkout-success">
      <span className="demo-success-icon"><Check size={32} aria-hidden="true" /></span>
      <h2>{copy?.title} plan for both of you</h2>
      <p>Your personal preparation, conversation guide, and shared journal are unlocked.</p>
      <Link className="button button-primary" onClick={clearCheckout} to={continuation.current ? `/fight-sessions/${encodeURIComponent(continuation.current)}` : '/home'}>{continuation.current ? 'Continue to conversation' : 'Go to your space'}<ArrowRight size={18} aria-hidden="true" /></Link>
      <p className="demo-success-note">Simulated payment · $0.00 charged</p>
    </section>
  </Page>;

  return <Page eyebrow="One plan. Both of you." title="Start the talk with a sentence that works." layout="wide" className="demo-checkout-page">
    <div className="demo-checkout-underlay">
      <aside className="demo-order-summary" aria-label="Order summary">
        <span className="demo-summary-icon"><HeartHandshake size={28} aria-hidden="true" /></span>
        <p className="eyebrow">Your selected plan</p><h2>{copy?.title}</h2>
        <div className="demo-plan-price">${amount?.toFixed(2)}<span>{copy?.period}</span></div>
        <p className="demo-plan-description">{copy?.description}</p>
        <ul className="demo-plan-benefits">
          <li><Check size={17} aria-hidden="true" /><span>Find the words for your next conversation</span></li>
          <li><Check size={17} aria-hidden="true" /><span>A free link so your partner can prepare too</span></li>
          <li><Check size={17} aria-hidden="true" /><span>Your shared check-ins and journal</span></li>
        </ul>
        <div className="demo-charge"><span>Charged today</span><strong>$0.00</strong></div>
        <p className="demo-charge-note">This is a simulation. No charge or recurring billing will be created.</p>
      </aside>
      <dialog ref={dialog} className="demo-payment-panel" aria-labelledby="demo-payment-heading" aria-describedby="demo-payment-note" onCancel={event => { event.preventDefault(); if (!busy) navigate('/checkout/cancel'); }}>
        <span className="demo-sheet-handle" aria-hidden="true" />
        <div className="demo-payment-heading"><h2 id="demo-payment-heading" tabIndex={-1}>Pay with card</h2><span className="demo-test-badge">Test mode</span></div>
        <div className="demo-checkout-line"><span>Kintsugi · {copy?.title}</span><strong>${amount?.toFixed(2)}</strong></div>
        <form ref={form} onSubmit={event => void submit(event)} noValidate autoComplete="off" aria-label="Demo payment details">
          <fieldset disabled={busy} className="demo-card-fields"><legend className="sr-only">Test card information</legend>
            <div className="demo-card-field"><label htmlFor="demo-name">Cardholder name</label><input id="demo-name" name="name" value={fields.name} onChange={event => update('name', event.target.value)} placeholder="Demo User" maxLength={80} required autoComplete="off" aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? 'demo-name-error' : undefined} />{errors.name && <span className="demo-field-error" id="demo-name-error">{errors.name}</span>}</div>
            <div className="demo-card-field"><label htmlFor="demo-number">Card number</label><input id="demo-number" name="number" value={fields.number} onChange={event => update('number', event.target.value.replace(/\D/g, '').slice(0, 16).replace(/(.{4})/g, '$1 ').trim())} placeholder="4242 4242 4242 4242" inputMode="numeric" maxLength={19} required autoComplete="off" aria-invalid={Boolean(errors.number)} aria-describedby={errors.number ? 'demo-number-error' : 'demo-payment-note'} />{errors.number && <span className="demo-field-error" id="demo-number-error">{errors.number}</span>}</div>
            <div className="demo-card-row">
              <div className="demo-card-field"><label htmlFor="demo-expiry">Expiry date</label><input id="demo-expiry" name="expiry" value={fields.expiry} onChange={event => { const value = event.target.value.replace(/\D/g, '').slice(0, 4); update('expiry', value.length > 2 ? `${value.slice(0, 2)}/${value.slice(2)}` : value); }} placeholder="MM/YY" inputMode="numeric" maxLength={5} required autoComplete="off" aria-invalid={Boolean(errors.expiry)} aria-describedby={errors.expiry ? 'demo-expiry-error' : undefined} />{errors.expiry && <span className="demo-field-error" id="demo-expiry-error">{errors.expiry}</span>}</div>
              <div className="demo-card-field"><label htmlFor="demo-cvc">CVC</label><input id="demo-cvc" name="cvc" value={fields.cvc} onChange={event => update('cvc', event.target.value.replace(/\D/g, '').slice(0, 3))} placeholder="123" inputMode="numeric" maxLength={3} required autoComplete="off" aria-invalid={Boolean(errors.cvc)} aria-describedby={errors.cvc ? 'demo-cvc-error' : undefined} />{errors.cvc && <span className="demo-field-error" id="demo-cvc-error">{errors.cvc}</span>}</div>
            </div>
          </fieldset>
          {error && <Notice kind="error">{error}</Notice>}
          <Button type="submit" className="demo-pay-button" disabled={busy}>{busy ? <><LoaderCircle className="spinner" size={18} aria-hidden="true" />Activating your plan…</> : <>Pay ${amount?.toFixed(2)}<ArrowRight size={18} aria-hidden="true" /></>}</Button>
          <p className="demo-payment-privacy" id="demo-payment-note"><ShieldCheck size={17} aria-hidden="true" /><span>Test card prefilled. No real charge. Use test details only; they stay in this page.</span></p>
          <div className="demo-checkout-cancel">{busy ? <span role="status">Confirming your demo plan…</span> : <Link to="/checkout/cancel"><ArrowLeft size={15} aria-hidden="true" />Cancel</Link>}</div>
        </form>
      </dialog>
    </div>
  </Page>;
}
