import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowRight, Check, Copy, LockKeyhole, RefreshCw } from 'lucide-react';
import { api, ApiError } from '../api/client';
import type { Checkout, Couple, Fight, PlanOption, Result, Subscription, TurnResponse } from '../api/types';
import { useSession } from '../app/session';
import { Button, Loading, Notice, Page, Scale } from '../components/ui';
import { config } from '../config';

const stageTitles: Record<string, string> = {
  thermometer_start: 'Before we begin', facts: 'What happened', feelings: 'Name the feeling',
  needs: 'What you need', partner_view: 'Another perspective', rehearsal: 'Try the words',
  thermometer_end: 'Check in with yourself', ready: 'Your next step',
};
const topicLabel = (value: string) => value.replaceAll('_', ' ').replace(/^./, c => c.toUpperCase());

function errorText(error: unknown, fallback = 'We could not connect. Please try again.') {
  if (error instanceof ApiError) {
    if (error.status === 503) return "We couldn't prepare the next step. Please try again.";
    if (error.status === 404) return 'This conversation is not available in this browser.';
    if (error.status === 401) return 'Your session has ended. Please start again.';
    return error.message || fallback;
  }
  return fallback;
}

// Private response data lives only in the mounted page, never persisted or cached.
function useResource<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const request = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const load = useCallback(async (quiet = false): Promise<T | null> => {
    if (!path) { setLoading(false); return null; }
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    if (!quiet) setLoading(true);
    try {
      const value = await api<T>(path, undefined, { signal: controller.signal });
      if (!alive.current || controller.signal.aborted) return null;
      setData(value); setError(null);
      return value;
    } catch (e) {
      if (alive.current && !controller.signal.aborted) setError(errorText(e));
      return null;
    } finally {
      if (alive.current && !controller.signal.aborted) setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    alive.current = true; setData(null); setError(null); void load();
    return () => { alive.current = false; request.current?.abort(); };
  }, [load]);
  return { data, setData, error, setError, loading, load, alive };
}

function useOperation() {
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const inFlight = useRef(false);
  const controller = useRef(new AbortController());
  useEffect(() => {
    controller.current = new AbortController();
    return () => controller.current.abort();
  }, []);
  useEffect(() => {
    setSlow(false);
    if (!busy) return;
    const timer = window.setTimeout(() => setSlow(true), 10000);
    return () => window.clearTimeout(timer);
  }, [busy]);
  return { busy, setBusy, slow, inFlight, controller };
}

function ProcessingNote() {
  return <p className="privacy-note">{config.llmMode === 'mock'
    ? 'This version uses demo responses. Your private answers are not sent to an external AI provider.'
    : config.llmMode === 'openai' || config.llmMode === 'anthropic'
      ? 'Your answers and selected profile details are sent to our AI provider to prepare your questions and personal summary. Your partner cannot see your private answers.'
      : 'Your answers and selected profile details may be sent to an external AI provider. Your partner cannot see your private answers.'}</p>;
}

export function FightPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { refresh } = useSession();
  const resource = useResource<Fight>(id ? `/fight-sessions/${encodeURIComponent(id)}` : null);
  const { data: fight, setData, load, alive } = resource;
  const operation = useOperation();
  const [draft, setDraft] = useState('');
  const [score, setScore] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [needsCheck, setNeedsCheck] = useState(false);
  const [confirm, setConfirm] = useState<'back' | 'skip' | null>(null);
  const current = fight?.currentTurn;
  const question = current?.type === 'next_turn' ? current : null;
  const locked = operation.busy || needsCheck;

  useEffect(() => {
    if (!fight) return;
    if (fight.status === 'completed') {
      setDraft(''); setScore(null); setData(null);
      navigate(`/fight-sessions/${id}/result`, { replace: true });
    } else if (fight.status === 'awaiting_payment') {
      setDraft(''); setScore(null); setData(null);
      navigate(`/paywall?sessionId=${encodeURIComponent(id)}`, { replace: true });
    } else if (fight.status === 'stopped_safety' || fight.status === 'skipped') {
      setDraft(''); setScore(null);
    }
  }, [fight, id, navigate, setData]);

  async function reconcile() {
    if (operation.inFlight.current) return;
    operation.inFlight.current = true; operation.setBusy(true);
    const before = question?.turnIndex;
    const fresh = await load(true);
    if (alive.current) {
      if (fresh) {
        setNeedsCheck(false);
        if (fresh.currentTurn?.type !== 'next_turn' || fresh.currentTurn.turnIndex !== before) {
          setDraft(''); setScore(null); setMessage(null);
        }
      }
      operation.setBusy(false);
    }
    operation.inFlight.current = false;
  }

  async function mutate(action: 'turns' | 'back' | 'skip-topic', body: unknown) {
    if (operation.inFlight.current || !fight || locked) return;
    operation.inFlight.current = true; operation.setBusy(true); setMessage(null); setConfirm(null);
    const previousIndex = question?.turnIndex;
    try {
      const response = await api<TurnResponse | Fight>(`/fight-sessions/${encodeURIComponent(id)}/${action}`, body, { signal: operation.controller.current.signal });
      if (!alive.current) return;
      setDraft(''); setScore(null);
      if ('sessionId' in response) {
        setData(response); setNeedsCheck(false);
      } else if (response.type === 'completed') {
        setData(null); void refresh().catch(() => undefined);
        navigate(`/fight-sessions/${id}/result`, { replace: true });
      } else if (response.type === 'paywall_required') {
        setData(null);
        navigate(`/paywall?sessionId=${encodeURIComponent(id)}`, { replace: true });
      } else if (response.type === 'safety_stop') {
        setData({ ...fight, status: 'stopped_safety', turns: [], currentTurn: response });
      } else {
        setNeedsCheck(true);
        const fresh = await load(true);
        if (alive.current && fresh) setNeedsCheck(false);
      }
    } catch (e) {
      if (!alive.current || operation.controller.current.signal.aborted) return;
      setMessage(errorText(e)); setNeedsCheck(true);
      const fresh = await load(true);
      if (alive.current && fresh) {
        setNeedsCheck(false);
        if (fresh.currentTurn?.type !== 'next_turn' || fresh.currentTurn.turnIndex !== previousIndex) {
          setDraft(''); setScore(null); setMessage(null);
        }
      }
    } finally {
      operation.inFlight.current = false;
      if (alive.current) operation.setBusy(false);
    }
  }

  function answer(source: 'card_left' | 'card_right' | 'free_text', text?: string) {
    if (!question) return;
    void mutate('turns', { turnIndex: question.turnIndex, answerSource: source, ...(text === undefined ? {} : { answerText: text }) });
  }

  if (resource.loading && !fight) return <Loading label="Opening your conversation…" />;
  if (!fight) return <Page title="Your conversation"><Notice>{resource.error || 'This conversation is unavailable.'}</Notice><div className="actions"><Button onClick={() => void load()}>Try again</Button><Link to="/home">Back to home</Link></div></Page>;
  if (current?.type === 'safety_stop') return <Page eyebrow="A moment for yourself" title="Your safety comes first.">
    <p className="lead">We’ve stopped this conversation. You can reach out to one of these resources for support.</p>
    <div className="stack">{current.hotlines.map(line => <a className="support-link" key={line.name} href={`tel:${line.phone.replace(/[^+0-9]/g, '')}`}><span>{line.name}</span><strong>{line.phone}</strong></a>)}</div>
    <p className="privacy-note">Your partner has not been notified about this stop.</p><Link className="text-link" to="/home">Return home</Link>
  </Page>;
  if (fight.status === 'skipped') return <Page eyebrow="Conversation closed" title="We can leave this here."><p className="lead">Your answers for this topic have been cleared.</p><Link className="button button-primary" to="/home">Return home <ArrowRight size={18} /></Link></Page>;
  if (!question) return <Loading label="Opening the next step…" />;

  const thermometer = question.stage === 'thermometer_start' || question.stage === 'thermometer_end';
  const number = question.progressStageIndex === null ? question.stage === 'thermometer_start' ? 'Before' : 'After' : String(question.progressStageIndex).padStart(2, '0');
  const count = [...draft].length;
  return <Page number={number} eyebrow={stageTitles[question.stage]} title={question.agentQuestion} className="conversation-page">
    <div className="conversation-meta"><span>Only your answers. Only your perspective.</span><span>{question.turnsUsed} / {question.turnsMax} answers</span></div>
    {question.stage === 'thermometer_start' && <ProcessingNote />}
    {(message || resource.error) && <Notice>{message || resource.error}</Notice>}
    {needsCheck && <div className="stack"><p>Check the saved conversation before answering again.</p><Button variant="secondary" disabled={operation.busy} onClick={() => void reconcile()}><RefreshCw size={16} /> Check again</Button></div>}
    {thermometer ? <div className="stack"><Scale value={score} onChange={setScore} disabled={locked} /><div className="scale-labels"><span>Not intense</span><span>Very intense</span></div><div className="actions"><Button disabled={score === null || locked} onClick={() => answer('free_text', String(score))}>Continue <ArrowRight size={18} /></Button></div></div>
      : <>
        <div className="option-grid answer-options">
          <button className="option" disabled={locked} onClick={() => answer('card_left')}><span>{question.optionLeft}</span><ArrowRight size={18} aria-hidden="true" /></button>
          <button className="option" disabled={locked} onClick={() => answer('card_right')}><span>{question.optionRight}</span><ArrowRight size={18} aria-hidden="true" /></button>
        </div>
        {question.stage !== 'ready' && <form className="free-answer" onSubmit={e => { e.preventDefault(); if (draft.trim() && count <= 4000) answer('free_text', draft); }}>
          <label htmlFor="own-answer">Or put it in your own words</label>
          <textarea id="own-answer" value={draft} disabled={locked} rows={3} placeholder="What feels true for you?" aria-describedby="answer-count" onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (draft.trim() && count <= 4000) answer('free_text', draft); } }} />
          <div className="answer-footer"><span id="answer-count">{count} / 4,000</span><Button disabled={!draft.trim() || count > 4000 || locked} type="submit">Continue <ArrowRight size={18} /></Button></div>
          {count > 4000 && <p role="alert">Please keep your answer within 4,000 characters.</p>}
        </form>}
      </>}
    <div aria-live="polite" className="request-status">{operation.busy && (operation.slow ? 'This is taking longer than usual.' : question.stage === 'ready' ? 'Preparing your summary…' : 'Preparing the next step…')}</div>
    {confirm && <Notice><p>{confirm === 'back' ? 'Going back clears your previous answer and anything after it.' : 'Skipping this topic clears your private answers for this conversation.'}</p><div className="actions"><Button disabled={locked} onClick={() => void mutate(confirm === 'back' ? 'back' : 'skip-topic', confirm === 'back' ? { turnIndex: fight.turns[fight.turns.length - 1].turnIndex } : {})}>{confirm === 'back' ? 'Go back' : 'Skip this topic'}</Button><Button variant="text" onClick={() => setConfirm(null)}>Cancel</Button></div></Notice>}
    <div className="conversation-navigation"><Button variant="text" disabled={locked || !fight.turns.length} onClick={() => setConfirm('back')}>Back</Button><Button variant="text" disabled={locked} onClick={() => setConfirm('skip')}>Skip this topic</Button></div>
    {fight.turns.length > 0 && <details className="history"><summary>Your earlier answers</summary>{fight.turns.map(turn => <div className="history-row" key={turn.turnIndex}><p className="eyebrow">{stageTitles[turn.stage]}</p><p>{turn.agentQuestion}</p><p className="your-answer">{turn.answerText}</p></div>)}</details>}
  </Page>;
}

export function ResultPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { couple, refresh } = useSession();
  const resource = useResource<Result>(id ? `/fight-sessions/${encodeURIComponent(id)}/result` : null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const result = resource.data;
  const loadResult = resource.load;
  const hasFullResult = Boolean(result && !result.locked.includes('openingLine'));
  const recordId = result?.fightRecordId;

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    let delay = 3000;
    async function poll() {
      if (stopped) return;
      if (document.visibilityState === 'visible') {
        const value = await loadResult(true);
        if (stopped) return;
        delay = value ? 3000 : Math.min(delay * 2, 15000);
        await refresh().catch(() => undefined);
        if (value?.fightRecordId) return;
      }
      if (!stopped) timer = window.setTimeout(poll, delay);
    }
    if (hasFullResult && !recordId) timer = window.setTimeout(poll, 3000);
    return () => { stopped = true; if (timer) window.clearTimeout(timer); };
  }, [hasFullResult, recordId, loadResult, refresh]);

  useEffect(() => { void refresh().catch(() => undefined); }, [refresh]);

  if (resource.loading && !result) return <Loading label="Opening your personal summary…" />;
  if (!result) return <Page title="Your personal summary"><Notice>{resource.error || 'Your summary is not ready yet.'}</Notice><div className="actions"><Button onClick={() => void resource.load()}>Try again</Button><Link to={`/fight-sessions/${id}`}>Return to conversation</Link></div></Page>;
  const locked = result.locked.includes('openingLine');
  if (locked) return <Page eyebrow="Your first insight" title="A little more clarity."><p className="lead">{result.feltText}</p><p>{result.needText}</p><Link className="button button-primary" to={couple?.subscription?.status === 'active' ? `/fight-sessions/${id}` : `/paywall?sessionId=${encodeURIComponent(id)}`}>Continue your conversation <ArrowRight size={18} /></Link></Page>;
  const canInvite = couple?.partnerRole === 'A' && !result.locked.includes('inviteUrl') && Boolean(couple.inviteUrl) && couple.currentSessionId === id;
  async function copyInvite() {
    if (!couple?.inviteUrl) return;
    try { await navigator.clipboard.writeText(couple.inviteUrl); setCopied(true); setCopyError(false); }
    catch { setCopyError(true); }
  }
  return <Page eyebrow="Your personal summary" title="A place to begin." number={<Check size={68} strokeWidth={1.2} />} className="result-page">
    <p className="eyebrow">{topicLabel(result.neutralTopic)} · Your opening words</p>
    <blockquote className="summary-line">“{result.openingLine}”</blockquote>
    <div className="result-reflections"><section><h2 className="eyebrow">What you felt</h2><p>{result.feltText}</p></section><section><h2 className="eyebrow">What you needed</h2><p>{result.needText}</p></section></div>
    <section className="result-rules"><h2>Make space for each other.</h2>{result.sharedRules.map((rule, index) => <div className="result-rule" key={rule}><span>{String(index + 1).padStart(2, '0')}</span><p>{rule}</p></div>)}</section>
    {result.thermometerStart !== null && result.thermometerEnd !== null && <p className="thermometer-result">Your intensity check-in <strong>{result.thermometerStart} → {result.thermometerEnd}</strong><span>Before and after preparing, on a scale of 1–10.</span></p>}
    {resource.error && <Notice>{resource.error}<Button variant="text" onClick={() => void resource.load(true)}>Check again</Button></Notice>}
    {result.fightRecordId ? <section className="next-step"><p className="eyebrow">You’re both ready</p><h2>Take this into your conversation.</h2><p>When you’ve talked, come back and check in about how it went.</p><div className="actions"><Button onClick={() => navigate(`/journal/${result.fightRecordId}/rating`)}>Rate your conversation <ArrowRight size={18} /></Button><Link to="/journal">View journal</Link></div></section>
      : <section className="next-step"><p className="eyebrow">The next step</p><h2>{canInvite ? 'Give your partner space to prepare.' : 'Your partner can prepare in their own time.'}</h2><p>{result.partnerStatus === 'in_progress' ? 'Your partner is preparing privately.' : 'Your answers stay private. You’ll come together with a clearer starting point.'}</p>
        {canInvite && <><div className="actions"><Button onClick={() => void copyInvite()}>{copied ? <Check size={18} /> : <Copy size={18} />}{copied ? 'Link copied' : 'Copy invite link'}</Button></div>{copyError && <label className="form-field">Copy this link to share<input readOnly value={couple?.inviteUrl || ''} onFocus={e => e.currentTarget.select()} /></label>}</>}
      </section>}
    <Link className="text-link" to="/home">Return home</Link>
  </Page>;
}

type SavedCheckout = { coupleId: string; sessionId: string | null; checkoutSessionId: string; plan: string };
const checkoutKey = 'lovelab.checkout';
function saveCheckout(value: SavedCheckout) { try { sessionStorage.setItem(checkoutKey, JSON.stringify(value)); } catch { /* Server bootstrap still restores the session. */ } }
function readCheckout(coupleId: string): SavedCheckout | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(checkoutKey) || 'null') as SavedCheckout | null;
    return value?.coupleId === coupleId ? value : null;
  } catch { return null; }
}
function clearCheckout() { try { sessionStorage.removeItem(checkoutKey); } catch { /* Storage can be disabled. */ } }

const fallbackPlans: PlanOption[] = [
  { plan: 'monthly', priceUsd: 14.99, isDefault: false },
  { plan: 'yearly', priceUsd: 99, isDefault: false },
  { plan: 'program', priceUsd: 149, isDefault: false },
];
const planCopy: Record<string, { title: string; period: string; description: string }> = {
  monthly: { title: 'Monthly', period: '/ month', description: 'Room to keep the conversation going.' },
  yearly: { title: 'Yearly', period: '/ year', description: 'A shared practice, throughout the year.' },
  program: { title: '8-week program', period: '/ 8 weeks', description: 'One payment for the 8-week plan.' },
};

export function PaywallPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { couple, refresh } = useSession();
  const id = params.get('sessionId');
  const fightResource = useResource<Fight>(id ? `/fight-sessions/${encodeURIComponent(id)}` : null);
  const resultResource = useResource<Result>(id ? `/fight-sessions/${encodeURIComponent(id)}/result` : null);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [skipConfirm, setSkipConfirm] = useState(false);
  const operation = useOperation();
  const plans = fightResource.data?.currentTurn?.type === 'paywall_required' ? fightResource.data.currentTurn.availablePlans : fallbackPlans;
  const pending = couple?.subscription?.status === 'pending';
  const selectedPlan = pending ? couple.subscription!.plan : selected || plans.find(plan => plan.isDefault)?.plan || couple?.defaultPlan || 'monthly';

  async function checkout() {
    if (!couple || operation.inFlight.current) return;
    operation.inFlight.current = true; operation.setBusy(true); setError(null);
    try {
      const result = await api<Checkout>('/subscriptions/checkout', { plan: selectedPlan }, { signal: operation.controller.current.signal });
      if (operation.controller.current.signal.aborted) return;
      saveCheckout({ coupleId: couple.coupleId, sessionId: id, checkoutSessionId: result.checkoutSessionId, plan: selectedPlan });
      const target = new URL(result.checkoutUrl, window.location.origin);
      if (target.protocol !== 'http:' && target.protocol !== 'https:') throw new Error('Unsupported checkout URL');
      window.location.assign(target.href);
    } catch (e) {
      if (!operation.controller.current.signal.aborted) { setError(errorText(e, 'Checkout is unavailable. Please try again.')); await refresh().catch(() => undefined); }
    } finally { operation.inFlight.current = false; operation.setBusy(false); }
  }

  async function skip() {
    if (!id || operation.inFlight.current) return;
    operation.inFlight.current = true; operation.setBusy(true);
    try {
      await api<Fight>(`/fight-sessions/${encodeURIComponent(id)}/skip-topic`, {}, { signal: operation.controller.current.signal });
      if (!operation.controller.current.signal.aborted) navigate(`/fight-sessions/${id}`, { replace: true });
    } catch (e) { if (!operation.controller.current.signal.aborted) setError(errorText(e)); }
    finally { operation.inFlight.current = false; operation.setBusy(false); }
  }

  if (couple?.partnerRole === 'B') return <Page title="Your partner manages your shared plan."><p className="lead">You join free when your couple has an active plan.</p><Link to="/home" className="text-link">Return home</Link></Page>;
  if (couple?.subscription?.status === 'active') return <Page title="Your shared plan is active."><Link className="button button-primary" to={id ? `/fight-sessions/${id}` : '/home'}>Continue <ArrowRight size={18} /></Link></Page>;
  if (id && (fightResource.loading || resultResource.loading)) return <Loading label="Opening your first insight…" />;
  if (id && (!fightResource.data || !resultResource.data)) return <Page title="Your first insight"><Notice>{fightResource.error || resultResource.error || 'Your insight is not available yet.'}</Notice><div className="actions"><Button onClick={() => { void fightResource.load(); void resultResource.load(); }}>Try again</Button><Link to={`/fight-sessions/${id}`}>Return to conversation</Link></div></Page>;
  return <Page eyebrow="Keep the conversation going" title="Clarity is a beginning." className="paywall-page">
    {resultResource.data && <section className="preview-insight"><p className="eyebrow">Your first insight</p><p className="lead">{resultResource.data.feltText}</p><p>{resultResource.data.needText}</p><p className="locked-line"><LockKeyhole size={16} /> Your opening words are next.</p></section>}
    <p className="lead">Make room for both of you.</p><p>Continue your private preparation, invite your partner, and come back to your shared journal. One plan for your couple. Your partner joins free.</p>
    <div className="plan-grid" role="radiogroup" aria-label="Choose your plan">{plans.map(plan => <label key={plan.plan} className={`plan ${selectedPlan === plan.plan ? 'selected' : ''}`}><input className="sr-only" type="radio" name="plan" value={plan.plan} checked={selectedPlan === plan.plan} disabled={operation.busy || Boolean(pending && plan.plan !== selectedPlan)} onChange={() => setSelected(plan.plan)} /><span className="plan-heading">{planCopy[plan.plan]?.title || plan.plan}{selectedPlan === plan.plan && <Check size={18} />}</span><span className="plan-price">${plan.priceUsd}<small>{planCopy[plan.plan]?.period}</small></span><span>{planCopy[plan.plan]?.description}</span></label>)}</div>
    {pending && <Notice>Your checkout is still open. Resume it to complete the selected plan.</Notice>}
    {config.paymentMode === 'mock' && <p className="mode-note">Simulated payment — no charge. No payment details are collected.</p>}
    {config.paymentMode === 'stripe_test' && <p className="mode-note">Test payment. Use Stripe test payment details.</p>}
    {error && <Notice>{error}</Notice>}
    <div className="actions"><Button disabled={operation.busy || !couple} onClick={() => void checkout()}>{operation.busy ? 'Opening checkout…' : pending ? 'Resume checkout' : 'Continue to checkout'}<ArrowRight size={18} /></Button><Link to="/home">Not now</Link></div>
    {id && <div className="paywall-skip">{skipConfirm ? <Notice><p>Skipping clears your private answers for this conversation.</p><div className="actions"><Button disabled={operation.busy} onClick={() => void skip()}>Skip this topic</Button><Button variant="text" onClick={() => setSkipConfirm(false)}>Cancel</Button></div></Notice> : <Button variant="text" disabled={operation.busy} onClick={() => setSkipConfirm(true)}>Skip this topic</Button>}</div>}
  </Page>;
}

export function CheckoutSuccessPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { couple, refresh } = useSession();
  const [error, setError] = useState<string | null>(null);
  const operation = useOperation();
  const attempted = useRef('');
  const checkoutId = params.get('session_id') || '';
  const coupleId = couple?.coupleId;
  const { inFlight, setBusy, controller } = operation;

  const confirm = useCallback(async () => {
    if (!coupleId || !checkoutId || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      await api<Subscription>('/subscriptions/confirm', { checkoutSessionId: checkoutId }, { signal: controller.current.signal });
      const saved = readCheckout(coupleId);
      const fresh: Couple | null = await refresh();
      if (controller.current.signal.aborted) return;
      const id = saved?.checkoutSessionId === checkoutId ? saved.sessionId : fresh?.currentSessionId;
      if (id) await api<Fight>(`/fight-sessions/${encodeURIComponent(id)}`, undefined, { signal: controller.current.signal });
      if (controller.current.signal.aborted) return;
      clearCheckout();
      navigate(id ? `/fight-sessions/${id}` : '/home', { replace: true });
    } catch (e) { if (!controller.current.signal.aborted) setError(errorText(e, 'We could not confirm your payment yet. Please try again.')); }
    finally { inFlight.current = false; setBusy(false); }
  }, [checkoutId, coupleId, navigate, refresh, inFlight, setBusy, controller]);

  useEffect(() => {
    if (!coupleId || !checkoutId || attempted.current === checkoutId) return;
    const timer = window.setTimeout(() => { attempted.current = checkoutId; void confirm(); }, 0);
    return () => window.clearTimeout(timer);
  }, [coupleId, checkoutId, confirm]);

  return <Page eyebrow="Returning to your conversation" title="Checking your plan."><p className="lead">We’ll continue from where you left off once your payment is confirmed.</p><div aria-live="polite">{operation.busy && <p>{operation.slow ? 'This is taking longer than usual.' : 'Confirming your payment…'}</p>}</div>{!checkoutId && <Notice>This return link has no checkout reference.</Notice>}{error && <Notice>{error}</Notice>}<div className="actions">{error && <Button disabled={operation.busy} onClick={() => void confirm()}>Check again</Button>}<Link to="/home">Return home</Link></div></Page>;
}

export function CheckoutCancelPage() {
  const { couple } = useSession();
  const saved = couple ? readCheckout(couple.coupleId) : null;
  return <Page eyebrow="Checkout paused" title="Take your time."><p className="lead">Your conversation is saved. You can resume checkout when you’re ready.</p><p>Returning here does not cancel an open checkout.</p><div className="actions"><Link className="button button-primary" to={saved?.sessionId ? `/paywall?sessionId=${encodeURIComponent(saved.sessionId)}` : '/paywall'}>Resume checkout <ArrowRight size={18} /></Link><Link to="/home">Return home</Link></div></Page>;
}
