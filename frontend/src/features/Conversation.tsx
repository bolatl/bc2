import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, ChevronDown, Copy, HeartHandshake, LockKeyhole, MessageSquareText, Mic, MicOff, Phone, RefreshCw, ShieldCheck, Sparkles, UsersRound } from 'lucide-react';
import { api, ApiError } from '../api/client';
import type { Checkout, Couple, Fight, Result, Subscription, TurnResponse } from '../api/types';
import { useSession } from '../app/session';
import { Button, Loading, Notice, Page, Scale } from '../components/ui';
import { LockedPreview } from '../components/LockedPreview';
import { ConversationReflection } from '../components/ConversationReflection';
import { SakuraJourney } from '../components/SakuraJourney';
import { PricingOptions } from '../components/PricingOptions';
import { config } from '../config';
import { clearCheckout, fallbackPlans, planCopy, planPrice, readCheckout, saveCheckout } from './checkout-state';
import { useSpeechToText } from '../hooks/useSpeechToText';
import { useQuestionMotion } from '../hooks/useQuestionMotion';
import '../styles/conversation.css';
import '../styles/prototype-flow.css';

// Keep in sync with MaxAnswerChars in internal/service/fight.go.
const maxAnswerChars = 300;
const stageTitles: Record<string, string> = {
  thermometer_start: 'Before we begin', facts: 'What happened', feelings: 'Name the feeling',
  needs: 'What you need', partner_view: 'Another perspective', rehearsal: 'Try the words',
  thermometer_end: 'Check in with yourself', ready: 'Your next step',
};
// Joins dictated text onto what is already in the answer, with one space between chunks.
const appendSpeech = (prev: string, text: string) => !prev ? text : /\s$/.test(prev) ? prev + text : `${prev} ${text}`;
const topicLabel = (value: string) => value.replaceAll('_', ' ').replace(/^./, c => c.toUpperCase());

function PreparationAside({ stage, turns, checkpoint = false }: { stage: string; turns: Fight['turns']; checkpoint?: boolean }) {
  const perspectiveStages = ['partner_view', 'rehearsal'];
  const hasPerspective = perspectiveStages.includes(stage) || turns.some(turn => perspectiveStages.includes(turn.stage));
  const labels = ['Understand your side', ...(hasPerspective ? ['Find a little perspective'] : []), 'Get ready to talk'];
  const active = ['thermometer_end', 'ready'].includes(stage) ? labels.length - 1 : perspectiveStages.includes(stage) ? 1 : 0;
  return <div className="preparation-guide">
    <SakuraJourney stage={stage} label={stageTitles[stage] ?? stage} turns={turns} checkpoint={checkpoint} />
    <ol className="preparation-steps">{labels.map((label, index) => <li key={label} className={index === active ? 'current' : index < active ? 'complete' : ''} aria-current={index === active ? 'step' : undefined}><span aria-hidden="true">{index < active ? <Check size={15} /> : index + 1}</span>{label}</li>)}</ol>
    <div className="private-space-note"><ShieldCheck size={21} aria-hidden="true" /><h2>A little space, just for you.</h2><p>Your partner won’t see your answers. Take a moment to figure out what you want to say.</p></div>
  </div>;
}

// A failed request may still have been saved. Only clear its error and draft
// when reconciliation confirms that the server moved to a different step.
function fightStep(fight: Fight) {
  const turn = fight.currentTurn;
  const step = turn?.type === 'next_turn' ? `${turn.stage}:${turn.turnIndex}`
    : turn?.type === 'checkpoint' ? turn.afterStage : '';
  return `${fight.status}:${turn?.type}:${step}`;
}

function ConversationPulse() {
  return <span className="conversation-pulse" aria-hidden="true"><span /><span /></span>;
}

function intensityLabel(value: number | null) {
  return value === null ? 'Choose what feels closest' : value <= 3 ? 'Pretty calm' : value <= 6 ? 'Feeling upset' : value <= 8 ? 'Really upset' : 'Very intense';
}

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
  const load = useCallback(async (quiet = false, beforeUpdate?: (value: T) => Promise<void>): Promise<T | null> => {
    if (!path) { setLoading(false); return null; }
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    if (!quiet) setLoading(true);
    try {
      const value = await api<T>(path, undefined, { signal: controller.signal });
      if (!alive.current || controller.signal.aborted) return null;
      await beforeUpdate?.(value);
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

export function FightPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { couple, refresh } = useSession();
  const resource = useResource<Fight>(id ? `/fight-sessions/${encodeURIComponent(id)}` : null);
  const { data: fight, setData, load, alive } = resource;
  const operation = useOperation();
  const [draft, setDraft] = useState('');
  const [score, setScore] = useState<number | null>(null);
  const [selected, setSelected] = useState<'card_left' | 'card_right' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [needsCheck, setNeedsCheck] = useState(false);
  const [confirm, setConfirm] = useState<'back' | 'skip' | null>(null);
  const speech = useSpeechToText(text => { setSelected(null); setDraft(prev => appendSpeech(prev, text)); });
  const current = fight?.currentTurn;
  const question = current?.type === 'next_turn' ? current : null;
  const locked = operation.busy || needsCheck;
  const motion = useQuestionMotion(fight ? `${id}:${fightStep(fight)}` : undefined);
  const motionDirection = useRef<'forward' | 'backward'>('forward');

  async function prepareFight(next: Fight) {
    if (!fight || fightStep(next) === fightStep(fight)) return;
    if (next.currentTurn?.type === 'next_turn' || next.currentTurn?.type === 'checkpoint') {
      await motion.leave(`${id}:${fightStep(next)}`, motionDirection.current);
    }
    if (alive.current) { setDraft(''); setScore(null); setSelected(null); }
  }

  useEffect(() => {
    if (!fight) return;
    if (fight.status === 'completed') {
      setDraft(''); setScore(null); setSelected(null); setData(null);
      navigate(`/fight-sessions/${id}/result`, { replace: true });
    } else if (fight.status === 'awaiting_payment') {
      setDraft(''); setScore(null); setSelected(null); setData(null);
      navigate(`/fight-sessions/${encodeURIComponent(id)}/insight`, { replace: true });
    } else if (fight.status === 'stopped_safety' || fight.status === 'skipped') {
      setDraft(''); setScore(null); setSelected(null);
    }
  }, [fight, id, navigate, setData]);

  async function reconcile() {
    if (operation.inFlight.current) return;
    operation.inFlight.current = true; operation.setBusy(true);
    const before = fight ? fightStep(fight) : null;
    const fresh = await load(true, prepareFight);
    if (alive.current) {
      if (fresh) {
        setNeedsCheck(false);
        if (fightStep(fresh) !== before) {
          setDraft(''); setScore(null); setSelected(null); setMessage(null);
        }
      }
      operation.setBusy(false);
    }
    operation.inFlight.current = false;
  }

  async function mutate(action: 'turns' | 'back' | 'skip-topic' | 'checkpoint', body: unknown) {
    if (operation.inFlight.current || !fight || locked) return;
    motionDirection.current = action === 'back' ? 'backward' : 'forward';
    operation.inFlight.current = true; operation.setBusy(true); setMessage(null); setConfirm(null);
    const previousStep = fightStep(fight);
    try {
      const response = await api<TurnResponse | Fight>(`/fight-sessions/${encodeURIComponent(id)}/${action}`, body, { signal: operation.controller.current.signal });
      if (!alive.current) return;
      if ('sessionId' in response) {
        await prepareFight(response);
        if (!alive.current) return;
        setData(response); setNeedsCheck(false);
      } else if (response.type === 'completed') {
        setData(null); void refresh().catch(() => undefined);
        navigate(`/fight-sessions/${id}/result`, { replace: true });
      } else if (response.type === 'paywall_required') {
        setData(null);
        navigate(`/fight-sessions/${encodeURIComponent(id)}/insight`, { replace: true });
      } else if (response.type === 'safety_stop') {
        setData({ ...fight, status: 'stopped_safety', turns: [], currentTurn: response });
      } else {
        setNeedsCheck(true);
        const fresh = await load(true, prepareFight);
        if (alive.current && fresh) setNeedsCheck(false);
      }
    } catch (e) {
      if (!alive.current || operation.controller.current.signal.aborted) return;
      setMessage(errorText(e)); setNeedsCheck(true);
      const fresh = await load(true, prepareFight);
      if (alive.current && fresh) {
        setNeedsCheck(false);
        if (fightStep(fresh) !== previousStep) {
          setDraft(''); setScore(null); setSelected(null); setMessage(null);
        }
      }
    } finally {
      operation.inFlight.current = false;
      if (alive.current) operation.setBusy(false);
    }
  }

  function answer(source: 'card_left' | 'card_right' | 'free_text', text?: string) {
    if (!question) return;
    speech.cancel();
    void mutate('turns', { turnIndex: question.turnIndex, answerSource: source, ...(text === undefined ? {} : { answerText: text }) });
  }

  if (resource.loading && !fight) return <Loading label="Opening your conversation…" />;
  if (!fight) return <Page title="Your conversation"><Notice>{resource.error || 'This conversation is unavailable.'}</Notice><div className="actions"><Button onClick={() => void load()}>Try again</Button><Link to="/home">Back to home</Link></div></Page>;
  if (current?.type === 'safety_stop') return <Page eyebrow="A moment for yourself" title="Your safety comes first." className="safety-page" number={<ShieldCheck size={42} aria-hidden="true" />}>
    <p className="lead">We’ve stopped this conversation. You can reach out to one of these resources for support.</p>
    <div className="stack">{current.hotlines.map(line => <a className="support-link" key={line.name} href={`tel:${line.phone.replace(/[^+0-9]/g, '')}`}><Phone size={21} aria-hidden="true" /><span>{line.name}<strong>{line.phone}</strong></span><ArrowRight size={18} aria-hidden="true" /></a>)}</div>
    <p className="privacy-note processing-note"><LockKeyhole size={16} aria-hidden="true" /><span>Your partner has not been notified about this stop.</span></p><Link className="text-link" to="/home">Return home <ArrowRight size={16} aria-hidden="true" /></Link>
  </Page>;
  if (fight.status === 'skipped') return <Page eyebrow="Conversation closed" title="We can leave this here."><p className="lead">Your answers for this topic have been cleared.</p><Link className="button button-primary" to="/home">Return home <ArrowRight size={18} /></Link></Page>;
  const feedback = <>
    {(message || resource.error) && <Notice kind="error">{message || resource.error}</Notice>}
    {needsCheck && <div className="stack"><p>Check the saved conversation before answering again.</p><Button variant="secondary" disabled={operation.busy} onClick={() => void reconcile()}><RefreshCw size={16} /> Check again</Button></div>}
  </>;
  const navigation = <>
    <div aria-live="polite" className="request-status">{operation.busy && <><ConversationPulse /><span>{operation.slow ? 'This is taking longer than usual.' : question?.stage === 'ready' ? 'Preparing your summary…' : 'Preparing the next step…'}</span></>}</div>
    {confirm && <Notice><p>{confirm === 'back' ? 'Going back clears your previous answer and anything after it.' : 'Ending this conversation clears your private answers.'}</p><div className="actions"><Button disabled={locked} onClick={() => void mutate(confirm === 'back' ? 'back' : 'skip-topic', confirm === 'back' ? { turnIndex: fight.turns[fight.turns.length - 1].turnIndex } : {})}>{confirm === 'back' ? 'Go back' : 'End conversation'}</Button><Button variant="text" onClick={() => setConfirm(null)}>Cancel</Button></div></Notice>}
    <div className="conversation-navigation"><Button variant="text" disabled={locked || !fight.turns.length} onClick={() => setConfirm('back')}><ArrowLeft size={16} aria-hidden="true" />Back</Button><Button variant="text" disabled={locked} onClick={() => setConfirm('skip')}>End conversation</Button></div>
    {fight.turns.length > 0 && <details className="history"><summary>Your earlier answers<ChevronDown size={17} aria-hidden="true" /></summary>{fight.turns.map(turn => <div className="history-row" key={turn.turnIndex}><p className="eyebrow">{stageTitles[turn.stage]}</p><p>{turn.agentQuestion}</p><p className="your-answer">{turn.answerText}</p></div>)}</details>}
  </>;
  if (current?.type === 'checkpoint') return <Page transitionKey={fightStep(fight)} motionRef={motion.contentRef} number={<MessageSquareText size={42} aria-hidden="true" />} eyebrow="A moment to check in" title={current.question} className={`conversation-page checkpoint-page ${couple?.partnerRole === 'B' ? 'conversation-partner' : ''}`} aside={<PreparationAside stage={current.afterStage} turns={fight.turns} checkpoint />}>
    <div className="conversation-meta"><span className="conversation-owner"><LockKeyhole size={14} aria-hidden="true" />Your private preparation</span><span>{fight.turns.length} answers saved</span></div>
    {feedback}
    <section className="checkpoint-summary" aria-label="Your private checkpoint summary">
      <div className="checkpoint-reflections"><div><HeartHandshake size={21} aria-hidden="true" /><h2>What you felt</h2><p>{current.summary.feltText}</p></div><div><Sparkles size={21} aria-hidden="true" /><h2>What you needed</h2><p>{current.summary.needText}</p></div></div>
      <div className="checkpoint-opening"><h2>A way to begin</h2><blockquote>“{current.summary.openingLine}”</blockquote></div>
    </section>
    <p className="checkpoint-guidance">This is your summary so far. Wrapping up takes you to the final steps, where you can choose whether you’re ready to talk.</p>
    <div className="actions checkpoint-actions">
      {current.decisions.includes('continue') && <Button disabled={locked} onClick={() => void mutate('checkpoint', { decision: 'continue' })}>Continue <ArrowRight size={18} aria-hidden="true" /></Button>}
      {current.decisions.includes('stop') && <Button variant="secondary" disabled={locked} onClick={() => void mutate('checkpoint', { decision: 'stop' })}>Wrap up</Button>}
    </div>
    {navigation}
  </Page>;
  if (!question) return <Loading label="Opening the next step…" />;

  const thermometer = question.stage === 'thermometer_start' || question.stage === 'thermometer_end';
  const story = question.stage === 'facts';
  const rehearsal = question.stage === 'rehearsal';
  const ready = question.stage === 'ready';
  const contextIndex = ['feelings', 'needs', 'partner_view'].indexOf(question.stage);
  const number = thermometer ? question.stage === 'thermometer_start' ? 'Before' : 'After' : contextIndex >= 0 ? String(contextIndex + 1).padStart(2, '0') : undefined;
  const currentScore = score ?? (question.stage === 'thermometer_end' ? fight.thermometerStart ?? 6 : 6);
  const answerText = speech.interim ? appendSpeech(draft, speech.interim) : draft;
  const count = [...answerText].length;
  const sendAnswer = () => {
    if (count > maxAnswerChars) return;
    if (answerText.trim()) { setDraft(answerText); answer('free_text', answerText); }
    else if (selected && !rehearsal) answer(selected);
  };
  const title = thermometer ? question.stage === 'thermometer_start' ? 'How upset are you right now?' : 'How upset are you now?'
    : story ? 'What happened? Keep it short.' : rehearsal ? 'Choose your first sentence.' : ready ? 'Ready to talk?' : question.agentQuestion;
  const examples = ['We had friends over. I cleaned up alone afterward.', 'My partner was late and did not text.', 'We argued about money for a trip.'];
  return <Page transitionKey={fightStep(fight)} motionRef={motion.contentRef} number={number} eyebrow={contextIndex >= 0 ? `Question ${contextIndex + 1}` : stageTitles[question.stage]} title={title} className={`conversation-page prototype-conversation ${couple?.partnerRole === 'B' ? 'conversation-partner' : ''}`} aside={<PreparationAside stage={question.stage} turns={fight.turns} />}>
    <div className="conversation-meta"><span className="conversation-owner"><LockKeyhole size={14} aria-hidden="true" />Only you see this</span></div>
    {feedback}
    {thermometer ? <div className="intensity-question">
      <div className={`intensity-display intensity-${currentScore <= 3 ? 'good' : currentScore <= 6 ? 'mid' : 'bad'}`}><output className="intensity-value" aria-live="polite">{currentScore}</output><strong>{intensityLabel(currentScore)}</strong></div>
      <Scale value={currentScore} onChange={setScore} disabled={locked} />
      <div className="scale-labels"><span>1 · calm</span><span>10 · furious</span></div>
      {question.stage === 'thermometer_end' && fight.thermometerStart !== null && <div className="intensity-change"><div><span>{fight.thermometerStart}</span><ArrowRight size={24} aria-hidden="true" /><span className="intensity-after">{currentScore}</span></div><p>{fight.thermometerStart > currentScore ? `You came down ${fight.thermometerStart - currentScore} point${fight.thermometerStart - currentScore === 1 ? '' : 's'}.` : 'It’s okay if this still feels difficult. Take the time you need.'}</p></div>}
      <div className="actions"><Button disabled={locked} onClick={() => answer('free_text', String(currentScore))}>Continue <ArrowRight size={18} aria-hidden="true" /></Button></div>
    </div> : ready ? <><p className="lead">Take this at your own pace. Your next screen brings your plan together.</p><Button className="prototype-submit" disabled={locked} onClick={() => answer('card_left')}>See your plan<ArrowRight size={18} /></Button></> : <>
      {rehearsal ? <RehearsalCards optionA={question.optionLeft} optionB={question.optionRight} partnerName={couple?.partnerName} selected={selected} onSelect={(choice, text) => { speech.cancel(); setSelected(choice); setDraft(text); }} disabled={locked} />
        : !story && <div className="option-grid answer-options" aria-label="Choose an answer">
          {([['card_left', question.optionLeft], ['card_right', question.optionRight]] as const).map(([choice, text]) => <button key={choice} className="option answer-card" aria-pressed={selected === choice} disabled={locked} onClick={() => { speech.cancel(); setSelected(choice); setDraft(''); }}><span className="answer-card-icon" aria-hidden="true">{selected === choice && <Check size={14} />}</span><span>{text}</span></button>)}
        </div>}
      <form className={`free-answer ${story ? 'story-answer' : ''}`} onSubmit={event => { event.preventDefault(); sendAnswer(); }}>
        <label htmlFor="own-answer">{story ? 'Your story' : rehearsal ? 'Say it your way' : 'Or in your own words'}</label>
        <div className="voice-field">
          <textarea id="own-answer" value={answerText} disabled={locked} rows={story ? 4 : 2} placeholder={story ? 'One or two sentences is enough.' : rehearsal ? 'Choose a sentence above, then make it your own.' : 'What feels true for you?'} aria-describedby="answer-count" onChange={event => { if (speech.isListening) speech.cancel(); setSelected(null); setDraft(event.target.value); }} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); sendAnswer(); } }} />
          <span className="voice-button-wrap" title={speech.isSupported ? undefined : 'Voice input works in Chrome, Edge or Safari'}><button type="button" className={`voice-button${speech.isListening ? ' is-listening' : ''}`} disabled={!speech.isSupported || locked} onClick={speech.isListening ? speech.stop : () => { setSelected(null); speech.start(); }} aria-label={!speech.isSupported ? 'Voice input works in Chrome, Edge or Safari' : speech.isListening ? 'Stop voice input' : 'Start voice input'}>{speech.isListening ? <MicOff size={18} aria-hidden="true" /> : <Mic size={18} aria-hidden="true" />}</button></span>
        </div>
        <p className={`voice-status${speech.error && !speech.isListening ? ' is-error' : ''}`} role="status">{speech.isListening ? <><span className="voice-dot" aria-hidden="true" />Listening…</> : speech.error}</p>
        <div className="answer-footer"><span id="answer-count">{count} / {maxAnswerChars}</span></div>
        {count > maxAnswerChars && <p role="alert">Please keep your answer within {maxAnswerChars} characters.</p>}
        {story && <div className="story-examples"><p>Or start from an example</p>{examples.map(example => <button type="button" disabled={locked} key={example} onClick={() => { speech.cancel(); setSelected(null); setDraft(example); }}>{example}</button>)}</div>}
        <Button className="prototype-submit" disabled={(!selected && !answerText.trim()) || count > maxAnswerChars || locked} type="submit">{rehearsal ? 'I’m ready' : story ? 'Continue' : 'Next'}<ArrowRight size={18} aria-hidden="true" /></Button>
      </form>
    </>}
    {navigation}
  </Page>;
}

function RehearsalCards({ optionA, optionB, partnerName, selected, onSelect, disabled, paywall }: {
  optionA: string; optionB: string; partnerName?: string; selected?: string | null;
  onSelect?: (choice: 'card_left' | 'card_right', text: string) => void; disabled?: boolean; paywall?: string;
}) {
  const name = partnerName || 'Your partner';
  return <><div className="rehearsal-options">{([['card_left', optionA], ['card_right', optionB]] as const).map(([choice, text], index) => <section className={`rehearsal-option ${selected === choice ? 'selected' : ''}`} key={choice}>
    <header><span>Option {index === 0 ? 'A' : 'B'}</span>{onSelect && <Button variant="secondary" disabled={disabled} aria-pressed={selected === choice} onClick={() => onSelect(choice, text)}>{selected === choice ? 'Chosen' : 'Use this'}</Button>}</header>
    <blockquote>“{text}”</blockquote>
    {paywall && index === 1 ? <div className="rehearsal-reaction-lock"><div className="rehearsal-blur" aria-hidden="true"><span /><span /></div><Link to={paywall}><LockKeyhole size={18} aria-hidden="true" />Explore another way to start</Link></div>
      : <div className="rehearsal-reaction"><p><strong>Possible reaction: </strong>{index === 0 ? `${name} may need a moment before replying to a direct request.` : `${name} may find it easier to discuss a specific next step.`}</p></div>}
  </section>)}</div><p className="rehearsal-disclaimer">These are practice scenarios, not predictions of what your partner thinks or will do.</p></>;
}

export function InsightPage() {
  const { id = '' } = useParams();
  const { couple } = useSession();
  const resource = useResource<Result>(`/fight-sessions/${encodeURIComponent(id)}/result`);
  const result = resource.data;
  if (resource.loading) return <Loading label="Finding what’s under it…" />;
  if (!result) return <Page title="Your first insight"><Notice>{resource.error}</Notice><Button onClick={() => void resource.load()}>Try again</Button></Page>;
  if (result.tier === 'full') return <Navigate to={`/fight-sessions/${id}`} replace />;
  return <Page title="Here’s what’s under it." eyebrow="Your first insight" layout="wide" className="insight-page">
    <div className="insight-cards"><section className="insight-card"><h2>You feel</h2><p>{result.feltText}</p></section><section className="insight-card"><h2>You need</h2><p>{result.needText}</p></section><section className="insight-card insight-card-shared"><h2>A calm topic for you both</h2><p>{topicLabel(result.neutralTopic)}</p><small>Your answers stay private. Only the topic is shared with {couple?.partnerName || 'your partner'}.</small></section></div>
    <Link className="button button-primary insight-next" to={result.rehearsal ? `/fight-sessions/${id}/rehearsal` : `/paywall?sessionId=${encodeURIComponent(id)}`}>Rehearse your first sentence<ArrowRight size={18} /></Link>
    <details className="optional-reflection"><summary>Explore your strengths and patterns</summary><ConversationReflection reflection={result.reflection} locked={result.locked.includes('openingLine')} feltText={result.feltText} needText={result.needText} /></details>
  </Page>;
}

export function RehearsalPreviewPage() {
  const { id = '' } = useParams();
  const { couple } = useSession();
  const resource = useResource<Result>(`/fight-sessions/${encodeURIComponent(id)}/result`);
  const result = resource.data;
  const paywall = `/paywall?sessionId=${encodeURIComponent(id)}`;
  if (resource.loading) return <Loading label="Opening your rehearsal…" />;
  if (!result) return <Page title="Your rehearsal"><Notice>{resource.error}</Notice><Button onClick={() => void resource.load()}>Try again</Button></Page>;
  if (result.tier === 'full' || !result.locked.includes('openingLine')) return <Navigate to={`/fight-sessions/${id}`} replace />;
  if (!result.rehearsal) return <Navigate to={paywall} replace />;
  return <Page eyebrow="Rehearsal" title="Two ways to start the talk." description={`Try the words before you say them to ${couple?.partnerName || 'your partner'}.`} layout="wide" className="rehearsal-preview-page">
    <RehearsalCards optionA={result.rehearsal.optionA} optionB={result.rehearsal.optionB} partnerName={couple?.partnerName} paywall={paywall} />
    <Link className="button button-primary insight-next" to={paywall}>Unlock your rehearsal<ArrowRight size={18} /></Link>
    <Link className="text-link" to={`/fight-sessions/${id}/insight`}><ArrowLeft size={16} />Back to your insight</Link>
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
  const isCurrent = couple?.currentSessionId === id;

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
    if (hasFullResult && !recordId && isCurrent) timer = window.setTimeout(poll, 3000);
    return () => { stopped = true; if (timer) window.clearTimeout(timer); };
  }, [hasFullResult, recordId, isCurrent, loadResult, refresh]);

  useEffect(() => { void refresh().catch(() => undefined); }, [refresh]);

  if (resource.loading && !result) return <Loading label="Opening your personal summary…" />;
  if (!result) return <Page title="Your personal summary"><Notice>{resource.error || 'Your summary is not ready yet.'}</Notice><div className="actions"><Button onClick={() => void resource.load()}>Try again</Button><Link to={`/fight-sessions/${id}`}>Return to conversation</Link></div></Page>;
  const locked = result.locked.includes('openingLine');
  if (locked) return <Page eyebrow="Your first insight" title="A little more clarity." layout="wide"><p className="lead">{result.feltText}</p><p>{result.needText}</p><LockedPreview variant="guide" action={<Link className="button button-primary" to={couple?.subscription?.status === 'active' ? `/fight-sessions/${id}` : `/paywall?sessionId=${encodeURIComponent(id)}`}>Continue your conversation <ArrowRight size={18} /></Link>} /></Page>;
  const canInvite = couple?.partnerRole === 'A' && !result.locked.includes('inviteUrl') && Boolean(couple.inviteUrl) && couple.currentSessionId === id;
  async function copyInvite() {
    if (!couple?.inviteUrl) return;
    try { await navigator.clipboard.writeText(couple.inviteUrl); setCopied(true); setCopyError(false); }
    catch { setCopyError(true); }
  }
  return <Page eyebrow={isCurrent ? 'You’re ready' : 'Previous conversation'} title="Your plan for the talk." layout="wide" className={`result-page ${couple?.partnerRole === 'B' ? 'conversation-partner' : ''}`}>
    <div className="prototype-ready-cards">
      <section className="opening-card"><h2>Only you see this</h2><p className="eyebrow">You feel</p><p>{result.feltText}</p><p className="eyebrow">You need</p><p>{result.needText}</p><p className="eyebrow">Your first sentence</p><blockquote className="summary-line">“{result.openingLine}”</blockquote></section>
      <section className="result-rules"><h2>Your shared topic</h2><h3>{topicLabel(result.neutralTopic)}</h3><p className="quiet">Agreements to suggest when you talk:</p>{result.sharedRules.map((rule, index) => <div className="result-rule" key={rule}><span>{index + 1}</span><p>{rule}</p></div>)}</section>
    </div>
    <div className="prototype-ready-bottom">
      <section className="next-step">
        {result.fightRecordId ? <><h2>You’re both ready.</h2><p>After the conversation, check in about how it went.</p><Button onClick={() => navigate(`/journal/${result.fightRecordId}/rating`)}>Rate your conversation<ArrowRight size={18} /></Button><Link className="text-link" to="/journal">View journal</Link></>
          : !isCurrent ? <><h2>Saved in your journal</h2><p>This is your preparation for an earlier conversation. Find your current conversation and its invitation in the journal.</p><Link className="text-link" to="/journal">Open journal<ArrowRight size={16} /></Link></>
            : <><h2>{canInvite ? `Invite ${couple?.partnerName || 'your partner'} to prepare.` : 'Give each other a little time.'}</h2><p>{result.partnerStatus === 'in_progress' ? 'Your partner is preparing privately.' : 'One link. A private preparation. Free for your partner.'}</p>{canInvite && <><Button onClick={() => void copyInvite()}>{copied ? <Check size={18} /> : <Copy size={18} />}{copied ? 'Link copied' : 'Copy invite link'}</Button>{copyError && <label className="form-field">Copy this link to share<input readOnly value={couple?.inviteUrl || ''} onFocus={event => event.currentTarget.select()} /></label>}</>}</>
        }
      </section>
      {result.thermometerStart !== null && <section className="thermometer-result"><h2>Your check-in</h2><div className="thermometer-comparison"><div><strong>{result.thermometerStart}</strong><span>Before</span></div>{result.thermometerEnd !== null && <><ArrowRight size={24} /><div><strong>{result.thermometerEnd}</strong><span>After</span></div></>}</div><p>How upset you felt, on a scale of 1–10.</p></section>}
    </div>
    {result.reflection && <details className="optional-reflection"><summary>Explore your personal reflection</summary><ConversationReflection reflection={result.reflection} /></details>}
    {resource.error && <Notice>{resource.error}<Button variant="text" onClick={() => void resource.load(true)}>Check again</Button></Notice>}
    <Link className="text-link result-home" to="/journal"><ArrowLeft size={16} />Back to journal</Link>
  </Page>;
}

export function PaywallPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { couple, refresh } = useSession();
  const id = params.get('sessionId');
  const subscriptionResource = useResource<Subscription>('/subscriptions/me');
  const fightResource = useResource<Fight>(id ? `/fight-sessions/${encodeURIComponent(id)}` : null);
  const resultResource = useResource<Result>(id ? `/fight-sessions/${encodeURIComponent(id)}/result` : null);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [skipConfirm, setSkipConfirm] = useState(false);
  const operation = useOperation();
  const catalog = fightResource.data?.currentTurn;
  const plans = catalog?.type === 'paywall_required' ? catalog.availablePlans : fallbackPlans;
  const subscription = subscriptionResource.data ?? couple?.subscription;
  const mixedCheckout = subscription?.status === 'pending' && Boolean(subscription.addOns?.length);
  const pending = subscription?.status === 'pending' && !mixedCheckout;
  const selectedPlan = pending ? subscription.plan : selected || plans.find(plan => plan.isDefault)?.plan || 'yearly';
  const total = planPrice(selectedPlan, plans);

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
      if (!operation.controller.current.signal.aborted) { setError(errorText(e, 'Checkout is unavailable. Please try again.')); await Promise.allSettled([refresh(), subscriptionResource.load(true)]); }
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
  if (subscriptionResource.loading) return <Loading label="Checking your plan…" />;
  if (subscriptionResource.error) return <Page title="Your shared plan"><Notice kind="error">{subscriptionResource.error}</Notice><Button onClick={() => void subscriptionResource.load()}>Try again</Button></Page>;
  if (subscription?.status === 'active') return <Page title="Your shared plan is active."><Link className="button button-primary" to={id ? `/fight-sessions/${id}` : '/home'}>Continue <ArrowRight size={18} /></Link></Page>;
  if (id && (fightResource.loading || resultResource.loading)) return <Loading label="Opening your first insight…" />;
  if (id && (!fightResource.data || !resultResource.data)) return <Page title="Your first insight"><Notice>{fightResource.error || resultResource.error || 'Your insight is not available yet.'}</Notice><div className="actions"><Button onClick={() => { void fightResource.load(); void resultResource.load(); }}>Try again</Button><Link to={`/fight-sessions/${id}`}>Return to conversation</Link></div></Page>;
  return <Page eyebrow="One plan. Both of you." title="Start the talk with a sentence that works." layout="wide" className="paywall-page prototype-paywall">
    <section className="plan-picker" aria-label="Choose a shared plan">
      <ul className="paywall-plan-benefits"><li><Check size={16} /><span>Practice your first sentence and make it your own</span></li><li><Check size={16} /><span>A free link for {couple?.partnerName || 'your partner'} to prepare too</span></li><li><Check size={16} /><span>Personal reflections, check-ins, and your shared journal</span></li></ul>
      {pending && !fallbackPlans.some(plan => plan.plan === selectedPlan) ? <Notice>Your saved checkout: {planCopy[selectedPlan]?.title} · ${planPrice(selectedPlan)} {planCopy[selectedPlan]?.period}.</Notice>
        : <PricingOptions plans={plans} selectedPlan={selectedPlan} onPlanChange={setSelected} disabled={operation.busy || Boolean(pending)} />}
      <div className="pricing-total"><span>{config.paymentMode === 'mock' ? 'Demo total' : 'Due today'}</span><strong>${total.toFixed(2)}</strong></div>
      {mixedCheckout && <Notice>Choose one option to replace your previous checkout.</Notice>}
      {pending && <Notice>Your checkout is still open. Resume it when you’re ready.</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      <div className="actions"><Button className="button-coral" disabled={operation.busy || !couple} onClick={() => void checkout()}>{operation.busy ? 'Opening checkout…' : pending ? 'Resume checkout' : 'Continue'}<ArrowRight size={18} /></Button><Link to={id ? `/fight-sessions/${id}/insight` : '/home'}>Not now</Link></div>
      <p className="plan-shared-note">One plan covers both of you. Your partner joins free.</p>
      {config.paymentMode === 'mock' && <p className="payment-mode-note">Demo checkout. Test card prefilled. No real charge.</p>}
      {config.paymentMode === 'stripe_test' && <p className="payment-mode-note">Test payment. Use Stripe test payment details.</p>}
    </section>
    {id && <div className="paywall-skip">{skipConfirm ? <Notice><p>Ending this conversation clears your private answers.</p><div className="actions"><Button disabled={operation.busy} onClick={() => void skip()}>End conversation</Button><Button variant="text" onClick={() => setSkipConfirm(false)}>Cancel</Button></div></Notice> : <Button variant="text" disabled={operation.busy} onClick={() => setSkipConfirm(true)}>End conversation</Button>}</div>}
  </Page>;
}

export function CheckoutSuccessPage() {
  const [params] = useSearchParams();
  const checkoutId = params.get('session_id') || '';
  // Old mock return links must not activate a plan before the user submits the
  // demo form. Real Stripe test returns keep their server verification flow.
  if (checkoutId.startsWith('cs_mock_')) return <Navigate to={`/checkout/demo?session_id=${encodeURIComponent(checkoutId)}&demo=true`} replace />;
  return <VerifiedCheckoutSuccessPage />;
}

function VerifiedCheckoutSuccessPage() {
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

  return <Page eyebrow="Returning to your conversation" title="Checking your plan." className="checkout-page" number={<UsersRound size={40} aria-hidden="true" />}><p className="lead">We’ll continue from where you left off once your payment is confirmed.</p><div aria-live="polite">{operation.busy && <p className="checkout-loading"><ConversationPulse />{operation.slow ? 'This is taking longer than usual.' : 'Confirming your payment…'}</p>}</div>{!checkoutId && <Notice>This return link has no checkout reference.</Notice>}{error && <Notice>{error}</Notice>}<div className="actions">{error && <Button disabled={operation.busy} onClick={() => void confirm()}>Check again</Button>}<Link to="/home">Return home</Link></div></Page>;
}

export function CheckoutCancelPage() {
  const { couple } = useSession();
  const saved = couple ? readCheckout(couple.coupleId) : null;
  return <Page eyebrow="Checkout paused" title="Take your time." className="checkout-page" number={<HeartHandshake size={40} aria-hidden="true" />}><p className="lead">Your conversation is saved. You can resume checkout when you’re ready.</p><p>Returning here does not cancel an open checkout.</p><div className="actions"><Link className="button button-primary" to={saved?.sessionId ? `/paywall?sessionId=${encodeURIComponent(saved.sessionId)}` : '/paywall'}>Resume checkout <ArrowRight size={18} /></Link><Link to="/home">Return home</Link></div></Page>;
}
