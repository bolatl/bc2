import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ArrowUpRight, Check, ChevronDown, ChevronLeft, HeartHandshake, Lightbulb, Link2, LockKeyhole, MessageCircle, MessageCircleHeart, ShieldCheck, Sparkles } from 'lucide-react';
import { api, ApiError } from '../api/client';
import type { CreateCouple, Fight, Invite, JoinInvite, Personality } from '../api/types';
import { useSession } from '../app/session';
import { Button, Loading, Notice, Page } from '../components/ui';
import { SakuraBough } from '../components/SakuraBackdrop';
import { partnerQuestions, personalityQuestions, personalityScale, profileQuestions, relationshipOptions, type ProfileField, type ProfileQuestion } from '../content/profile';

import '../styles/onboarding.css';

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
  return <div className="welcome-page">
    <section className="welcome-hero">
      <div className="welcome-copy">
        <p className="welcome-kicker"><span aria-hidden="true" />For couples who keep having the same fight</p>
        <h1>Rehearse the first sentence <span>before you say it.</span></h1>
        <p className="welcome-lead">Prepare in private. Find the words, try a different opening, and come back ready to talk.</p>
        {error && <Notice kind="error">{error} <button className="text-link" onClick={() => { void refresh().catch(() => undefined); }}>Try connecting again</button></Notice>}
        <div className="welcome-actions welcome-entry-actions">
          {loading ? <Loading label="Checking your session…" /> : couple ? <Link className="button button-primary" to="/home">Continue<ArrowRight size={19} aria-hidden="true" /></Link> : <>
            <Link className="button button-primary" to="/onboarding">We just had a fight<ArrowRight size={19} aria-hidden="true" /></Link>
            <Link className="button button-secondary" to="/onboarding?entry=engaged">We’re engaged. Prepare us<ArrowRight size={19} aria-hidden="true" /></Link>
          </>}
        </div>
        <p className="welcome-private"><LockKeyhole size={14} aria-hidden="true" />Prepare privately. Invite your partner when you’re ready.</p>
      </div>
      <div className="welcome-example" aria-labelledby="example-heading">
        <SakuraBough className="welcome-bough" />
        <div className="example-heading-row"><span className="example-icon"><MessageCircleHeart size={24} aria-hidden="true" /></span><span className="example-label">Conversation example</span></div>
        <h2 id="example-heading">Same moment.<br />Two ways to start.</h2>
        <div className="example-sentence example-sentence-before">
          <span className="example-caption">When the words come out sharp</span>
          <blockquote>“You never help.”</blockquote>
          <span className="example-note">A criticism that leaves little room to talk.</span>
        </div>
        <div className="example-connector" aria-hidden="true"><span /><ArrowRight size={20} /><span /></div>
        <div className="example-sentence example-sentence-after">
          <span className="example-caption">With a little space to reflect</span>
          <blockquote>“I felt alone tonight. Can we plan cleanup together?”</blockquote>
          <span className="example-note"><Check size={15} aria-hidden="true" />Your experience, with a clear request.</span>
        </div>
        <div className="example-footer"><span className="example-overlap" aria-hidden="true"><i /><i /></span><p>Your side matters.<br /><strong>So does finding a way forward.</strong></p></div>
      </div>
    </section>
    <section className="welcome-process" id="how-it-works" aria-labelledby="process-heading">
      <div className="welcome-section-heading"><div><p className="eyebrow">How it works</p><h2 id="process-heading">A few small steps before the talk.</h2></div><p>One moment. Your feelings. A first sentence.</p></div>
      <div className="process-grid" aria-label="How Kintsugi works">
        <article className="process-card"><div className="process-card-top"><span className="process-icon process-icon-you"><MessageCircle size={24} aria-hidden="true" /></span><span className="process-number">01</span></div><h3>Tell what happened</h3><p>One or two sentences, then a few quick questions.</p></article>
        <article className="process-card"><div className="process-card-top"><span className="process-icon process-icon-partner"><HeartHandshake size={24} aria-hidden="true" /></span><span className="process-number">02</span></div><h3>See what’s underneath</h3><p>What you feel, what you need, and a calm topic to discuss.</p></article>
        <article className="process-card"><div className="process-card-top"><span className="process-icon process-icon-neutral"><Sparkles size={24} aria-hidden="true" /></span><span className="process-number">03</span></div><h3>Rehearse, then talk</h3><p>Try an opening line. Invite your partner to prepare too.</p></article>
      </div>
      <div className="welcome-trust"><span><ShieldCheck size={18} aria-hidden="true" />No verdict on who’s right</span><span><LockKeyhole size={18} aria-hidden="true" />Your raw answers stay private</span><span><Link2 size={18} aria-hidden="true" />One plan for both of you</span></div>
    </section>
    <section className="welcome-faq" id="questions" aria-labelledby="faq-heading"><div><p className="eyebrow">Before you begin</p><h2 id="faq-heading">A few things<br />you might wonder.</h2></div><div className="welcome-faq-list">
      <details><summary>Does my partner need an account?<ChevronDown size={18} aria-hidden="true" /></summary><p>No. Share your invitation once your preparation is complete and your plan is active. Your partner opens it in their own browser, answers three questions, and prepares privately.</p></details>
      <details><summary>Will my partner see what I write?<ChevronDown size={18} aria-hidden="true" /></summary><p>Your answers and personal guide are private. The shared journal contains the conversation topic, dates, and check-ins.</p></details>
    </div></section>
  </div>;
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
  return <Page transitionKey={`profile-${step}`} className={`wizard-page ${partner ? 'wizard-partner' : ''}`} number={String(step + 1).padStart(2, '0')} eyebrow={`${partner ? 'Your own perspective' : 'A little about you'} · ${step + 1} of ${questions.length}`} title={question.title} description={question.description}>
    <div className="wizard-progress" role="progressbar" aria-label="Profile questions" aria-valuemin={0} aria-valuemax={questions.length} aria-valuenow={step + 1}><span style={{ width: `${(step + 1) / questions.length * 100}%` }} /></div>
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
      <p className="wizard-privacy"><LockKeyhole size={15} aria-hidden="true" /><span>{partner ? 'These answers are for your private preparation.' : 'Your answers help shape your private conversation.'} This form is saved when you finish.</span></p>
    </form>
  </Page>;
}

function InitialProfileWizard({ engaged, onComplete, busy, error }: {
  engaged: boolean; onComplete: (answers: Answers) => void; busy: boolean; error: string;
}) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Answers>({ partnerName: '', relationshipStatus: engaged ? 'engaged' : 'married' });
  const [advancing, setAdvancing] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);
  const question = step > 0 ? profileQuestions[step - 1] : null;
  const title = question?.title ?? 'Who’s this about?';
  const partnerName = String(answers.partnerName ?? '');
  const pending = busy || advancing;

  function choose(value: string) {
    if (!question || pending) return;
    const next = { ...answers, [question.key]: value };
    setAnswers(next);
    setAdvancing(true);
    timer.current = window.setTimeout(() => {
      setAdvancing(false);
      timer.current = null;
      if (step === 3) onComplete(next);
      else setStep(previous => previous + 1);
    }, 250);
  }

  return <Page transitionKey={`initial-profile-${step}`} className="wizard-page initial-profile-page" layout="wide" eyebrow={`A little about you · ${step + 1} of 4`} title={title} description={question?.description}>
    <div className="initial-profile-topbar">
      {step === 0 ? <Link to="/" className="initial-profile-back" aria-label="Back to welcome"><ChevronLeft size={20} aria-hidden="true" /></Link>
        : <Button variant="text" className="initial-profile-back" disabled={pending} onClick={() => setStep(previous => previous - 1)} aria-label="Back"><ChevronLeft size={20} aria-hidden="true" /></Button>}
      <div className="wizard-progress" role="progressbar" aria-label="Profile questions" aria-valuemin={0} aria-valuemax={4} aria-valuenow={step + 1}><span style={{ width: `${(step + 1) * 25}%` }} /></div>
      <span className="initial-profile-count">{step + 1} / 4</span>
    </div>
    <form onSubmit={event => { event.preventDefault(); if (step === 0 && partnerName.trim() && !pending) { setAnswers(previous => ({ ...previous, partnerName: partnerName.trim() })); setStep(1); } }} className="stack">
      {step === 0 ? <>
        <label className="initial-profile-name" htmlFor="partner-name">Your partner’s first name
          <input id="partner-name" name="partnerName" autoComplete="off" placeholder="First name" value={partnerName} maxLength={40} onChange={event => setAnswers(previous => ({ ...previous, partnerName: Array.from(event.target.value).slice(0, 20).join('') }))} required aria-describedby="partner-name-help" />
        </label>
        <span className="quiet initial-profile-name-help" id="partner-name-help">So the conversation feels personal.</span>
        <fieldset className="form-field initial-relationship" disabled={pending}><legend>You are</legend><div className="initial-relationship-options">
          {relationshipOptions.map(([value, label]) => <label className={`initial-relationship-chip ${answers.relationshipStatus === value ? 'selected' : ''}`} key={value}>
            <input className="sr-only" type="radio" name="relationshipStatus" value={value} checked={answers.relationshipStatus === value} onChange={() => setAnswers(previous => ({ ...previous, relationshipStatus: value }))} />{label}
          </label>)}
        </div></fieldset>
        <Button className="initial-profile-continue" type="submit" disabled={!partnerName.trim() || pending}>Continue<ArrowRight size={18} aria-hidden="true" /></Button>
      </> : question && <fieldset className="form-field" disabled={pending}>
        <legend className="sr-only">{title}</legend>
        <div className="initial-profile-choices">{question.options.map(([value, label]) => <button className={`option initial-profile-option ${answers[question.key] === value ? 'selected' : ''}`} key={value} type="button" aria-pressed={answers[question.key] === value} disabled={pending} onClick={() => choose(value)}>
          <span className="initial-profile-dot" aria-hidden="true">{answers[question.key] === value && <Check size={13} />}</span><span>{label}</span><ArrowRight className="initial-profile-option-arrow" size={17} aria-hidden="true" />
        </button>)}</div>
      </fieldset>}
      <div aria-live="polite" className="initial-profile-status">{busy ? 'Saving your profile…' : advancing ? 'Selected. Moving on…' : step > 0 ? 'Tap an answer to continue.' : ''}</div>
      {error && <Notice kind="error">{error}{step === 3 && <Button variant="text" disabled={pending} onClick={() => onComplete(answers)}>Try again</Button>}</Notice>}
      <p className="wizard-privacy"><LockKeyhole size={15} aria-hidden="true" /><span>Your answers help shape your private preparation.</span></p>
    </form>
  </Page>;
}

export function OnboardingPage() {
  const { couple, loading, refresh } = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { busy, error, run } = useAction();
  const creating = useRef(false);
  if (loading) return <Loading />;
  if (couple && !creating.current) return <Navigate to="/home" replace />;
  return <InitialProfileWizard engaged={params.get('entry') === 'engaged'} busy={busy} error={error} onComplete={(answers) => { creating.current = true; void run(async (signal) => {
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
    if (signal.aborted) return;
    try {
      const fight = await api<Fight>('/fight-sessions', {}, { signal });
      await refresh();
      if (!signal.aborted) navigate(`/fight-sessions/${fight.sessionId}`, { replace: true });
    } catch {
      if (!signal.aborted) navigate('/choose', { replace: true });
    }
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
  return <Page className="choose-page" layout="wide" eyebrow="Make room for a conversation" title="Where would you like to start?" description="Start with what’s on your mind, or get to know your own patterns first.">
    <div className="choose-grid">
      <button className="choose-card choose-card-conversation" disabled={busy} onClick={() => { void run(start); }}>
        <span className="choose-card-top"><span className="choose-icon"><MessageCircleHeart size={30} aria-hidden="true" /></span><span className="choose-pill">Start here</span></span>
        <span className="choose-card-copy"><strong>{busy ? 'Getting ready…' : couple.currentSessionId ? 'Continue your conversation' : 'Talk to Kintsugi now'}</strong><span>Make sense of what happened and find a first sentence that feels like you.</span></span>
        <span className="choose-card-bottom">Your private preparation<ArrowUpRight size={23} aria-hidden="true" /></span>
      </button>
      <Link className="choose-card choose-card-profile" to={couple.personalityDone ? '/personality/result' : '/personality'}>
        <span className="choose-card-top"><span className="choose-icon"><Lightbulb size={30} aria-hidden="true" /></span><span className="choose-pill">Optional</span></span>
        <span className="choose-card-copy"><strong>{couple.personalityDone ? 'View your personal profile' : 'Take the 3-minute profile first'}</strong><span>Get to know the strengths and patterns you bring to a conversation.</span></span>
        <span className="choose-card-bottom">20 short questions<ArrowUpRight size={23} aria-hidden="true" /></span>
      </Link>
    </div>
    {error && <Notice kind="error">{error}</Notice>}
    <p className="choose-note"><LockKeyhole size={16} aria-hidden="true" />Both paths are private. You can come back to your profile at any time.</p>
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
  return <Page transitionKey={`personality-${step}`} className="wizard-page personality-page" number={String(step + 1).padStart(2, '0')} eyebrow={`Your profile · ${step + 1} of 20`} title={personalityQuestions[step]} description="How accurately does this describe you?">
    <div className="wizard-progress" role="progressbar" aria-label="Personality questions" aria-valuemin={0} aria-valuemax={20} aria-valuenow={step + 1}><span style={{ width: `${(step + 1) / 20 * 100}%` }} /></div>
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
  return <Page className="personality-result-page" layout="wide" eyebrow="Your personal profile" title="A little more understanding. A place to begin." description="A few strengths to bring to your next conversation, and small things to try.">
    <div className="profile-report-grid">
      <section className="profile-report-card profile-report-strengths"><span className="report-icon"><Sparkles size={24} aria-hidden="true" /></span><h2>What you bring</h2><p className="profile-report-intro">Strengths to keep close in a difficult moment.</p><ul className="insight-list">{query.data.strengths.map((text, index) => <li key={index}><Check size={19} aria-hidden="true" /><span>{text}</span></li>)}</ul></section>
      <section className="profile-report-card"><span className="report-icon"><Lightbulb size={24} aria-hidden="true" /></span><h2>Something to try</h2><p className="profile-report-intro">Small adjustments can make room for each other.</p><ol className="numbered-list">{query.data.tips.map((text, index) => <li key={index}>{text}</li>)}</ol></section>
    </div>
    <div className="profile-report-footer"><div className="actions"><Link to="/home#patterns" className="button button-primary">See my patterns<ArrowRight size={18} aria-hidden="true" /></Link><Link to="/journal" className="text-link">Go to journal</Link></div></div>
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
  if (previewError) return <Page eyebrow="Partner invitation" title="Let’s find your invitation."><Notice>{previewError}</Notice><div className="actions"><Button onClick={() => setAttempt(attempt + 1)}>Try again</Button><Link className="text-link" to="/">Back to Kintsugi</Link></div></Page>;
  if (!preview) return <Loading label="Opening your invitation…" />;
  return <>
    <div className="invite-intro"><span className="invite-icon"><HeartHandshake size={26} aria-hidden="true" /></span><div><p className="eyebrow">An invitation to understand each other</p><p>{preview.message}</p></div><span className="invite-private"><LockKeyhole size={15} aria-hidden="true" />Your own perspective</span></div>
    <ProfileWizard partner questions={partnerQuestions} busy={busy} error={error} onComplete={(answers) => { void run(async (signal) => {
      try { await api<JoinInvite>(`/invites/${encodeURIComponent(token)}/join`, answers, { signal }); }
      catch (err) {
        if (err instanceof ApiError && err.status === 409) throw new Error('If you are in your partner’s browser, open this link in a separate browser profile. If you already joined, return to the browser you used to accept the invitation.', { cause: err });
        throw err;
      }
      if (signal.aborted) return;
      const current = await refresh();
      if (signal.aborted) return;
      if (current?.currentSessionId) { navigate(`/fight-sessions/${current.currentSessionId}`, { replace: true }); return; }
      try {
        const fight = await api<Fight>('/fight-sessions', {}, { signal });
        await refresh();
        if (!signal.aborted) navigate(`/fight-sessions/${fight.sessionId}`, { replace: true });
      } catch {
        if (!signal.aborted) navigate('/choose', { replace: true });
      }
    }); }} />
  </>;
}
