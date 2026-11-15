import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ArrowUpRight, Check, ChevronLeft } from 'lucide-react';
import { api, ApiError } from '../api/client';
import type { CreateCouple, Fight, Invite, JoinInvite, Personality } from '../api/types';
import { useSession } from '../app/session';
import { Button, Loading, Notice, Page } from '../components/ui';
import { partnerQuestions, personalityQuestions, personalityScale, profileQuestions, type ProfileField, type ProfileQuestion } from '../content/profile';

type Answers = Partial<Record<ProfileField, string | string[]>>;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; request.current?.abort(); };
  }, []);
  const run = useCallback(async (action: (signal: AbortSignal) => Promise<void>) => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError('');
    try { await action(controller.signal); }
    catch (err) { if (alive.current && !controller.signal.aborted) setError(errorMessage(err)); }
    finally {
      request.current = null;
      if (alive.current) setBusy(false);
    }
  }, []);
  return { busy, error, run };
}

export function WelcomePage() {
  const { couple, loading, error, refresh } = useSession();
  return <section className="hero">
    <div className="hero-top"><p className="eyebrow">A little space to understand each other</p></div>
    <h1 className="hero-title">Better conversations<br /> start <span>with you.</span></h1>
    <div className="hero-bottom">
      <div className="hero-copy">
        <p className="lead">Work through what happened privately.<br />Find the words you want to start with.</p>
        {error && <Notice kind="error">{error} <button className="text-link" onClick={() => { void refresh().catch(() => undefined); }}>Try connecting again</button></Notice>}
        <div className="actions">
          {loading ? <Loading label="Checking your session…" /> : <Link className="button button-primary" to={couple ? '/home' : '/onboarding'}>{couple ? 'Continue' : 'Get started'}<ArrowRight size={19} aria-hidden="true" /></Link>}
          <span className="quiet">Start on your own. Invite your partner when you’re ready.</span>
        </div>
      </div>
      <div className="hero-steps" aria-label="How Love Lab works">
        <div className="step-row"><span className="step-index">01</span><div><h2>Prepare separately</h2><p>Give your feelings and needs a little room.</p></div></div>
        <div className="step-row"><span className="step-index">02</span><div><h2>Talk together</h2><p>Start with a first sentence that feels like you.</p></div></div>
        <div className="step-row"><span className="step-index">03</span><div><h2>Check in</h2><p>Reflect on how the conversation went.</p></div></div>
      </div>
    </div>
  </section>;
}

function ProfileWizard({ questions, onComplete, busy, error, partner = false }: {
  questions: ProfileQuestion[]; onComplete: (answers: Answers) => void; busy: boolean; error: string; partner?: boolean;
}) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Answers>({});
  const question = questions[step];
  const value = answers[question.key];
  const selected = Array.isArray(value) ? value : value ? [value] : [];
  const isLast = step === questions.length - 1;
  function select(option: string) {
    setAnswers((previous) => {
      if (!question.multiple) return { ...previous, [question.key]: option };
      const current = Array.isArray(previous[question.key]) ? previous[question.key] as string[] : [];
      const next = current.includes(option) ? current.filter((item) => item !== option) : current.length < 3 ? [...current, option] : current;
      return { ...previous, [question.key]: next };
    });
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || selected.length === 0) return;
    if (isLast) onComplete(answers);
    else setStep(step + 1);
  }
  return <Page number={String(step + 1).padStart(2, '0')} eyebrow={`${partner ? 'Your own perspective' : 'A little about you'} · ${step + 1} of ${questions.length}`} title={question.title} description={question.description}>
    <form onSubmit={submit} className="stack">
      <fieldset className="form-field" disabled={busy}>
        <legend className="sr-only">{question.title}</legend>
        <div className="option-grid">
          {question.options.map(([option, label]) => <label key={option} className={`option ${selected.includes(option) ? 'selected' : ''}`}>
            <input type={question.multiple ? 'checkbox' : 'radio'} name={question.key} value={option} checked={selected.includes(option)} disabled={busy || Boolean(question.multiple && selected.length === 3 && !selected.includes(option))} onChange={() => select(option)} />
            <span>{label}</span>
          </label>)}
        </div>
      </fieldset>
      {error && <Notice kind="error">{error}</Notice>}
      <div className="actions">
        <Button type="submit" disabled={busy || selected.length === 0}>{busy ? 'Saving…' : isLast ? 'Save and continue' : 'Continue'}<ArrowRight size={18} aria-hidden="true" /></Button>
        {step > 0 && <Button type="button" variant="text" disabled={busy} onClick={() => setStep(step - 1)}><ChevronLeft size={17} aria-hidden="true" />Back</Button>}
      </div>
      <p className="quiet">{partner ? 'These answers are for your private preparation.' : 'Your answers help shape your private conversation.'} This form is saved when you finish.</p>
    </form>
  </Page>;
}

export function OnboardingPage() {
  const { couple, loading, refresh } = useSession();
  const navigate = useNavigate();
  const { busy, error, run } = useAction();
  const creating = useRef(false);
  if (loading) return <Loading />;
  if (couple && !creating.current) return <Navigate to="/home" replace />;
  return <ProfileWizard questions={profileQuestions} busy={busy} error={error} onComplete={(answers) => { creating.current = true; void run(async (signal) => {
    try { await api('/couples', answers as CreateCouple, { signal }); }
    catch (err) {
      if (!signal.aborted) {
        const restored = await refresh();
        if (restored) { navigate('/choose', { replace: true }); return; }
      }
      throw err;
    }
    if (signal.aborted) return;
    await refresh();
    navigate('/choose', { replace: true });
  }); }} />;
}

export function ChoosePage() {
  const { couple, loading, refresh } = useSession();
  const navigate = useNavigate();
  const { busy, error, run } = useAction();
  if (loading) return <Loading />;
  if (!couple) return <Navigate to="/" replace />;
  async function start(signal: AbortSignal) {
    if (couple?.currentSessionId) { navigate(`/fight-sessions/${couple.currentSessionId}`); return; }
    try {
      const fight = await api<Fight>('/fight-sessions', {}, { signal });
      await refresh();
      if (!signal.aborted) navigate(`/fight-sessions/${fight.sessionId}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 402) { navigate('/paywall'); return; }
      if (!signal.aborted) {
        const current = await refresh();
        if (current?.currentSessionId) { navigate(`/fight-sessions/${current.currentSessionId}`); return; }
      }
      throw err;
    }
  }
  return <Page eyebrow="Make room for a conversation" title="Where would you like to start?" description="Start with what’s on your mind, or get to know your own patterns first.">
    <div className="stack">
      <button className="choice-card" disabled={busy} onClick={() => { void run(start); }}>
        <span><span className="eyebrow">Your conversation</span><strong>{busy ? 'Getting ready…' : couple.currentSessionId ? 'Continue your conversation' : 'Talk to Love Lab now'}</strong><span>Take a moment to sort through what happened.</span></span><ArrowUpRight aria-hidden="true" />
      </button>
      <Link className="choice-card" to={couple.personalityDone ? '/personality/result' : '/personality'}>
        <span><span className="eyebrow">Your perspective</span><strong>{couple.personalityDone ? 'View your personal profile' : 'Take the 3-minute profile first'}</strong><span>20 short questions about how you tend to respond.</span></span><ArrowUpRight aria-hidden="true" />
      </Link>
      {error && <Notice kind="error">{error}</Notice>}
      <p className="quiet">The personal profile is optional. You can come back to it later.</p>
    </div>
  </Page>;
}

export function PersonalityPage() {
  const { couple, loading, refresh } = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<(number | null)[]>(Array(20).fill(null));
  const { busy, error, run } = useAction();
  if (loading) return <Loading />;
  if (!couple) return <Navigate to="/" replace />;
  function submit(event: FormEvent) {
    event.preventDefault();
    if (answers[step] === null || busy) return;
    if (step < 19) { setStep(step + 1); return; }
    void run(async (signal) => {
      await api<Personality>('/personality-tests', { answers }, { signal });
      await queryClient.invalidateQueries({ queryKey: ['personality'] });
      await refresh();
      if (!signal.aborted) navigate('/personality/result', { replace: true });
    });
  }
  return <Page number={String(step + 1).padStart(2, '0')} eyebrow={`Your profile · ${step + 1} of 20`} title={personalityQuestions[step]} description="How accurately does this describe you?">
    <form onSubmit={submit} className="stack">
      <fieldset className="form-field" disabled={busy}><legend className="sr-only">How accurately does this describe you?</legend>
        <div className="option-grid single-column">{personalityScale.map((label, index) => <label key={label} className={`option ${answers[step] === index + 1 ? 'selected' : ''}`}>
          <input type="radio" name="accuracy" checked={answers[step] === index + 1} onChange={() => setAnswers((previous) => previous.map((value, answerIndex) => answerIndex === step ? index + 1 : value))} />
          <span>{label}</span>
        </label>)}</div>
      </fieldset>
      {error && <Notice kind="error">{error}</Notice>}
      <div className="actions">
        <Button type="submit" disabled={busy || answers[step] === null}>{busy ? 'Preparing your profile…' : step === 19 ? 'See my profile' : 'Continue'}<ArrowRight size={18} aria-hidden="true" /></Button>
        {step > 0 && <Button variant="text" type="button" disabled={busy} onClick={() => setStep(step - 1)}>Back</Button>}
      </div>
      <Link className="text-link" to="/choose">Come back to this later</Link>
    </form>
  </Page>;
}

export function PersonalityResultPage() {
  const { couple, loading } = useSession();
  const query = useQuery({ queryKey: ['personality', couple?.coupleId, couple?.partnerRole], queryFn: ({ signal }) => api<Personality>('/personality-tests/me', undefined, { signal }), enabled: Boolean(couple), retry: false });
  if (loading || (couple && query.isPending)) return <Loading label="Loading your profile…" />;
  if (!couple) return <Navigate to="/" replace />;
  if (query.error || !query.data) return <Page eyebrow="Your profile" title="A little more self-understanding.">
    <Notice>{query.error instanceof ApiError && query.error.status === 404 ? 'Take the personal profile to see your strengths and suggestions here.' : errorMessage(query.error)}</Notice>
    <div className="actions"><Link to="/personality" className="button button-primary">Take the profile<ArrowRight size={18} aria-hidden="true" /></Link><Button variant="text" onClick={() => { void query.refetch(); }}>Try again</Button></div>
  </Page>;
  return <Page eyebrow="Your personal profile" title="A little more understanding. A place to begin." description="A few strengths to bring to your next conversation, and small things to try.">
    <section className="stack"><h2 className="section-heading">What you bring</h2><ul className="insight-list">{query.data.strengths.map((text, index) => <li key={index}><Check size={20} aria-hidden="true" /><span>{text}</span></li>)}</ul></section>
    <section className="stack section-block"><h2 className="section-heading">Something to try</h2><ol className="numbered-list">{query.data.tips.map((text, index) => <li key={index}>{text}</li>)}</ol></section>
    <div className="actions"><Link to="/choose" className="button button-primary">Continue<ArrowRight size={18} aria-hidden="true" /></Link><Link to="/home" className="text-link">Back to home</Link></div>
    <p className="quiet">This is a reflection tool, not a diagnosis or a label.</p>
  </Page>;
}

export function InvitePage() {
  const { token = '' } = useParams();
  const { refresh } = useSession();
  const navigate = useNavigate();
  const [preview, setPreview] = useState<Invite | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const { busy, error, run } = useAction();
  useEffect(() => {
    const controller = new AbortController();
    setPreview(null); setPreviewError('');
    void api<Invite>(`/invites/${encodeURIComponent(token)}`, undefined, { signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) setPreview(result);
    }).catch((err: unknown) => {
      if (!controller.signal.aborted) setPreviewError(err instanceof ApiError && err.status === 404 ? 'This invitation is unavailable. Ask your partner to share their current link.' : errorMessage(err));
    });
    return () => controller.abort();
  }, [token, attempt]);
  if (previewError) return <Page eyebrow="Partner invitation" title="Let’s find your invitation."><Notice>{previewError}</Notice><div className="actions"><Button onClick={() => setAttempt(attempt + 1)}>Try again</Button><Link className="text-link" to="/">Back to Love Lab</Link></div></Page>;
  if (!preview) return <Loading label="Opening your invitation…" />;
  return <>
    <div className="invite-intro"><p className="eyebrow">An invitation to understand each other</p><p>{preview.message}</p></div>
    <ProfileWizard partner questions={partnerQuestions} busy={busy} error={error} onComplete={(answers) => { void run(async (signal) => {
      try { await api<JoinInvite>(`/invites/${encodeURIComponent(token)}/join`, answers, { signal }); }
      catch (err) {
        if (err instanceof ApiError && err.status === 409) throw new Error('If you are in your partner’s browser, open this link in a separate browser profile. If you already joined, return to the browser you used to accept the invitation.', { cause: err });
        throw err;
      }
      if (signal.aborted) return;
      await refresh();
      navigate('/choose', { replace: true });
    }); }} />
  </>;
}
