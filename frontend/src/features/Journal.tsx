import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ArrowUpRight, BookOpen, Check, CircleHelp, Copy, Flower2, HeartHandshake, LockKeyhole, MessageCircle, RefreshCw, ShieldCheck, Sparkles, Trash2, UserRound } from 'lucide-react';
import { api, ApiError, errorMessage } from '../api/client';
import type { Couple, Fight, FightRecord, Journal, JournalEntry, ConversationList, ConversationSummary } from '../api/types';
import { useSession } from '../app/session';
import { Button, Loading, Notice, Page, Scale } from '../components/ui';
import { LockedPreview } from '../components/LockedPreview';
import { ConversationReflection } from '../components/ConversationReflection';
import '../styles/journal.css';
import '../styles/conversation-journal.css';

export function topicName(topic: string) { return ({ money: 'Money', chores: 'Sharing the chores', kids: 'Parenting', family: 'Family', phone: 'Phone time', jealousy: 'Jealousy', closeness: 'Feeling close', plans_decisions: 'Plans and decisions', time_attention: 'Time and attention', other: 'Something on your mind' } as Record<string, string>)[topic] ?? topic; }
function date(value: string) { return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }

function partnerState(couple: Couple) {
  return {
    not_started: { title: 'Not ready yet', description: 'Your partner has not started preparing for this conversation.', ready: false },
    in_progress: { title: 'Preparing privately', description: 'Your partner is taking time to prepare. Their answers stay private.', ready: false },
    ready: { title: 'Ready to talk', description: 'Your partner has finished preparing for this conversation.', ready: true },
  }[couple.partnerStatus];
}

function useCurrentPreparation() {
  const { couple } = useSession();
  return useQuery({ queryKey: ['home-fight', couple?.coupleId, couple?.partnerRole, couple?.currentSessionId], queryFn: ({ signal }) => api<Fight>(`/fight-sessions/${couple!.currentSessionId}`, undefined, { signal }), enabled: !!couple?.currentSessionId });
}

export function PartnerPage() {
  const { couple, refresh } = useSession();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const current = useCurrentPreparation();
  const refreshPreparation = current.refetch;
  const hasPreparation = Boolean(couple?.currentSessionId);
  useEffect(() => {
    void refresh().catch(() => undefined);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void Promise.all([refresh(), ...(hasPreparation ? [refreshPreparation({ throwOnError: true })] : [])]).catch(() => undefined);
      }
    }, 15000);
    return () => window.clearInterval(timer);
  }, [refresh, refreshPreparation, hasPreparation]);
  async function check() {
    if (checking) return;
    setChecking(true); setError('');
    try { await Promise.all([refresh(), ...(hasPreparation ? [refreshPreparation({ throwOnError: true })] : [])]); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setChecking(false); }
  }
  async function copy() {
    if (!couple?.inviteUrl) return;
    try { await navigator.clipboard.writeText(couple.inviteUrl); setCopied(true); setCopyError(false); }
    catch { setCopyError(true); }
  }
  const partner = couple ? partnerState(couple) : null;
  const ownReady = current.data?.status === 'completed';
  return <Page className="partner-space-page personal-space-page" layout="wide" eyebrow="Partner" title="Your partner’s progress" description="Check their status for the current conversation. Their answers and personal reflection stay private.">
    <div className="partner-space-grid">
      <section className="partner-preparation-card dashboard-card">
        <div className="partner-view-label"><span className="person-badge person-partner"><UserRound size={24} /></span><div><span className="eyebrow">Your partner</span><p>Preparation status</p></div><span className={`readiness-badge ${partner?.ready ? 'is-ready' : ''}`}>{partner?.ready ? <Check size={14} /> : <Flower2 size={15} />}{partner?.ready ? 'Ready' : 'Not ready'}</span></div>
        <h2>{partner?.title}</h2><p className="partner-state-description">{partner?.description}</p>
        {couple && <ol className="partner-progress" aria-label="Your partner’s preparation progress">{['Not started', 'Preparing', 'Ready to talk'].map((label, index) => {
          const reached = { not_started: 0, in_progress: 1, ready: 2 }[couple.partnerStatus];
          return <li key={label} className={index <= reached ? 'reached' : ''} aria-current={index === reached ? 'step' : undefined}>{label}</li>;
        })}</ol>}
        <div className="pair-readiness" aria-label="Both partners’ readiness"><div><span className={`person-badge person-you ${ownReady ? 'is-ready' : ''}`}>{ownReady ? <Check size={24} /> : <UserRound size={24} />}</span><strong>You</strong><span>{couple?.currentSessionId && current.isPending ? 'Checking…' : current.error ? 'Unable to check' : ownReady ? 'Ready to talk' : 'Your own preparation'}</span></div><span className="pair-readiness-connection" aria-hidden="true"><Flower2 size={21} /></span><div><span className={`person-badge person-partner ${partner?.ready ? 'is-ready' : ''}`}>{partner?.ready ? <Check size={24} /> : <UserRound size={24} />}</span><strong>{couple?.partnerName || 'Your partner'}</strong><span>{partner?.ready ? 'Ready to talk' : 'Not ready yet'}</span></div></div>
        <div className="actions">{couple?.partnerRole === 'A' && couple.inviteUrl && <Button onClick={() => void copy()}>{copied ? <Check size={17} /> : <Copy size={17} />}{copied ? 'Link copied' : 'Copy invite link'}</Button>}<Button variant="secondary" disabled={checking} onClick={() => void check()}><RefreshCw size={16} />{checking ? 'Checking…' : 'Refresh status'}</Button></div>
        {copyError && <label className="form-field invite-copy-field">Copy this link to share<input readOnly value={couple?.inviteUrl || ''} onFocus={event => event.currentTarget.select()} /></label>}
        {error && <Notice kind="error">{error}</Notice>}
      </section>
      <aside className="partner-space-aside">
        <section className="partner-privacy-card"><LockKeyhole size={22} strokeWidth={1.4} /><h2>A little privacy helps you be honest.</h2><p>This view shares readiness, not your partner’s answers, personality reflection, or personal summary.</p><Link className="text-link" to="/home">Return to your own space<ArrowUpRight size={16} /></Link></section>
        <Link className="dashboard-link partner-journal-link" to="/journal"><BookOpen size={23} strokeWidth={1.4} /><span><strong>Your conversations</strong><span>Continue your preparation or revisit a previous conversation.</span></span><ArrowUpRight size={18} /></Link>
      </aside>
    </div>
  </Page>;
}

function AccessNotice({ error, retry, variant = 'journal' }: { error: unknown; retry: () => void; variant?: 'journal' | 'patterns' }) {
  const { couple } = useSession();
  if (error instanceof ApiError && error.status === 402) return <LockedPreview variant={variant} title={variant === 'patterns' ? 'See your patterns over time.' : 'A place for your conversations.'} description={couple?.partnerRole === 'A' ? 'Your couple’s plan includes a shared journal, personal conversation guides, and check-ins over time.' : 'This part of your shared space opens when your partner activates a plan.'} action={couple?.partnerRole === 'A' ? <Link className="button button-primary" to="/paywall">View plans<ArrowRight size={18} /></Link> : <Link className="button button-secondary" to="/home">Return to your space<ArrowRight size={18} /></Link>} />;
  return <Notice kind="error">{errorMessage(error)}<Button variant="text" onClick={retry}>Try again</Button></Notice>;
}

export function JournalPage() {
  const { couple, refresh } = useSession();
  const navigate = useNavigate();
  const cache = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => { void refresh().catch(() => undefined); }, [refresh]);
  const query = useQuery({ queryKey: ['conversations', couple?.coupleId, couple?.partnerRole], queryFn: ({ signal }) => api<ConversationList>('/fight-sessions', undefined, { signal }), refetchInterval: 15_000 });
  const shared = useQuery({ queryKey: ['journal', couple?.coupleId, couple?.partnerRole], queryFn: ({ signal }) => api<Journal>('/journal', undefined, { signal }), enabled: couple?.subscription?.status === 'active' || Boolean(query.data?.conversations.some(item => item.tier === 'full')), refetchInterval: 15_000 });
  const conversations = query.data?.conversations ?? [];
  const current = conversations.filter(item => item.isCurrent);
  const previous = conversations.filter(item => !item.isCurrent);
  const records = new Map((shared.data ?? []).map(record => [record.id, record]));
  const canStart = query.data?.canStartNew ?? false;
  const initiator = couple?.partnerRole === 'A';
  const startHint = query.isPending ? 'Checking your current conversation…' : query.error ? 'Reload your conversations to start another.'
    : !initiator ? canStart ? 'Your partner is ready. Take a few minutes to prepare privately.' : 'You can prepare when your partner’s next invitation is ready.'
      : canStart ? 'A fresh partner link will be ready when you finish preparing. Previous invitation links expire when you start again.'
        : current.some(item => item.status === 'in_progress' || item.status === 'awaiting_payment') ? 'Finish or close your current preparation before starting another conversation.'
          : 'Your partner is still preparing. You can start a new conversation when they’re ready.';

  async function start() {
    if (request.current || !canStart) return;
    const controller = new AbortController(); request.current = controller;
    const previousId = couple?.currentSessionId;
    setBusy(true); setError('');
    try {
      const fight = await api<Fight>('/fight-sessions', {}, { signal: controller.signal });
      await refresh();
      await cache.invalidateQueries({ queryKey: ['conversations'] });
      if (!controller.signal.aborted) navigate(`/fight-sessions/${fight.sessionId}`);
    } catch (reason) {
      if (controller.signal.aborted) return;
      if (reason instanceof ApiError && reason.status === 402) { navigate('/paywall'); return; }
      try {
        const found = await refresh();
        if (!controller.signal.aborted && found?.currentSessionId && found.currentSessionId !== previousId) {
          navigate(`/fight-sessions/${found.currentSessionId}`); return;
        }
      } catch { /* Keep the original error and allow a safe retry. */ }
      if (!controller.signal.aborted) { setError(errorMessage(reason)); void query.refetch(); }
    } finally { request.current = null; if (!controller.signal.aborted) setBusy(false); }
  }

  return <Page className="journal-page conversation-journal" layout="wide" eyebrow="Journal" title="Your conversations" description="Continue where you left off, look back at a previous conversation, or start something new.">
    <div className="journal-toolbar">
      <div><Button disabled={!canStart || busy} onClick={() => void start()}><MessageCircle size={18} />{busy ? 'Getting ready…' : initiator ? 'New conversation' : 'Prepare your side'}<ArrowRight size={18} /></Button>
        <p className="quiet">{startHint}</p>
      </div>
      {couple?.subscription?.status === 'active' && <span className="journal-plan-note"><Check size={16} />Your plan covers new conversations.</span>}
    </div>
    {error && <Notice kind="error">{error}</Notice>}
    {query.isPending ? <Loading label="Opening your conversations…" /> : query.error ? <Notice kind="error">{errorMessage(query.error)}<Button variant="text" onClick={() => void query.refetch()}>Try again</Button></Notice> : <>
      <section className="journal-conversation-section" aria-labelledby="current-conversation-heading"><div className="journal-section-heading"><h2 id="current-conversation-heading">Current conversation</h2><Link className="text-link" to="/partner">Partner’s status<ArrowUpRight size={16} /></Link></div>
        {current.length ? current.map(item => <ConversationRow key={item.sessionId} conversation={item} record={item.fightRecordId ? records.get(item.fightRecordId) : undefined} />)
          : <div className="journal-empty dashboard-card"><BookOpen size={30} /><h3>{canStart && !initiator ? 'Your partner is ready to talk.' : 'No conversation in progress.'}</h3><p>{canStart ? 'Use the button above when you’re ready to begin.' : 'Your next conversation will appear here.'}</p></div>}
      </section>
      <section className="journal-conversation-section" aria-labelledby="previous-conversations-heading"><div className="journal-section-heading"><h2 id="previous-conversations-heading">Previous conversations</h2><span className="quiet">Most recent first</span></div>
        {previous.length ? previous.map(item => <ConversationRow key={item.sessionId} conversation={item} record={item.fightRecordId ? records.get(item.fightRecordId) : undefined} />) : <p className="journal-no-history">Your earlier conversations will stay here as you start new ones.</p>}
      </section>
      {shared.error && !(shared.error instanceof ApiError && shared.error.status === 402) && <Notice kind="error">Your conversations are available, but shared check-ins could not load.<Button variant="text" onClick={() => void shared.refetch()}>Retry check-ins</Button></Notice>}
      <p className="journal-privacy"><LockKeyhole size={17} />Your preparation and personal summaries stay private. Only the topic and shared check-ins are visible to both of you.</p>
    </>}
  </Page>;
}

function ConversationRow({ conversation, record }: { conversation: ConversationSummary; record?: FightRecord }) {
  const { couple } = useSession();
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const active = conversation.status === 'in_progress' || conversation.status === 'awaiting_payment';
  const completed = conversation.status === 'completed';
  const status = completed ? 'Ready to talk' : active ? 'Preparing' : 'Closed';
  const partnerStatus = { not_started: 'Not ready yet', in_progress: 'Preparing', ready: 'Ready to talk' }[conversation.partnerStatus];
  const href = completed && conversation.resultAvailable
    ? conversation.fightRecordId ? `/journal/${conversation.fightRecordId}` : `/fight-sessions/${conversation.sessionId}/result`
    : `/fight-sessions/${conversation.sessionId}`;
  async function copy() {
    try { await navigator.clipboard.writeText(conversation.inviteUrl); setCopied(true); setCopyError(false); }
    catch { setCopyError(true); }
  }
  return <article className={`journal-row conversation-row ${conversation.isCurrent ? 'is-current' : ''}`} data-session-id={conversation.sessionId}>
    <span className={`journal-topic-icon rating-${record?.color ?? 'gray'}`}><MessageCircle size={22} /></span>
    <div className="journal-row-copy"><p className="quiet">{date(conversation.createdAt)}</p><h3>{conversation.neutralTopic ? topicName(conversation.neutralTopic) : 'New conversation'}</h3>
      <div className="conversation-statuses"><span className={completed ? 'is-ready' : ''}>You: {status}</span><span>Partner: {partnerStatus}</span></div>
      {record && <p className="record-status"><span className={`status-dot ${record.color}`} />{record.status === 'not_discussed' ? 'Not talked yet' : record.status === 'pending' ? 'Waiting for both check-ins' : 'Both checked in'}{record.averageRating !== null && <strong className={`rating-${record.color}`}> · {record.averageRating} / 10 together</strong>}</p>}
      {record?.divergenceFlag && <p className="divergence-note">Your ratings differ. Make a little time to check in.</p>}
      <div className="actions"><Link className="button button-secondary journal-summary-link" to={href}>{active ? 'Continue conversation' : completed ? 'View your summary' : 'View conversation'}<ArrowUpRight size={16} /></Link>
        {conversation.inviteUrl && <Button variant="text" onClick={() => void copy()}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? 'Link copied' : 'Copy invite link'}</Button>}
        {record?.bothReadyAt && <Link className="text-link" to={`/journal/${record.id}/rating`}>Check in<ArrowUpRight size={16} /></Link>}
      </div>
      {copyError && <label className="form-field invite-copy-field">Copy this link to share<input readOnly value={conversation.inviteUrl} onFocus={event => event.currentTarget.select()} /></label>}
      {conversation.isCurrent && active && couple?.partnerRole === 'A' && <p className="quiet conversation-invite-note">Your partner link becomes available after you finish preparing.</p>}
    </div>
  </article>;
}

export function JournalEntryPage() {
  const { recordId = '' } = useParams();
  const { couple } = useSession();
  const query = useQuery({
    queryKey: ['journal-entry', couple?.coupleId, couple?.partnerRole, recordId],
    queryFn: ({ signal }) => api<JournalEntry>(`/journal/${encodeURIComponent(recordId)}`, undefined, { signal }),
    enabled: Boolean(couple && recordId),
  });
  const entry = query.data;
  const result = entry?.myResult;
  return <Page className={`result-page journal-entry-page ${couple?.partnerRole === 'B' ? 'conversation-partner' : ''}`} layout="wide" eyebrow="From your journal" title="Your conversation, revisited.">
    <Link className="text-link journal-back" to="/journal">Back to journal<ArrowUpRight size={16} /></Link>
    {query.isPending ? <Loading label="Opening your past conversation…" /> : query.error ? (
      query.error instanceof ApiError && query.error.status === 404
        ? <Notice>This conversation is unavailable.</Notice>
        : <AccessNotice error={query.error} retry={() => void query.refetch()} />
    ) : entry && <div className="result-workspace">
      <section className="result-main journal-entry-summary" aria-labelledby="personal-summary-heading">
        <h2 id="personal-summary-heading">Your personal summary</h2>
        {result ? <>
          <section className="opening-card">
            <div className="opening-card-top"><span className="conversation-owner"><LockKeyhole size={14} aria-hidden="true" />Only you see this</span><span className="topic-pill">{topicName(entry.topic)}</span></div>
            <p className="eyebrow">Your opening words</p>
            {result.locked.includes('openingLine') ? <p>Your opening words are unavailable.</p> : <blockquote className="summary-line">“{result.openingLine}”</blockquote>}
            <span className="opening-card-note"><MessageCircle size={16} aria-hidden="true" />A starting point. Make it sound like you.</span>
          </section>
          <div className="result-reflections"><section><HeartHandshake size={22} aria-hidden="true" /><h3>What you felt</h3><p>{result.feltText}</p></section><section><Sparkles size={22} aria-hidden="true" /><h3>What you needed</h3><p>{result.needText}</p></section></div>
          {result.sharedRules.length > 0 && <section className="result-rules"><div className="result-section-title"><HeartHandshake size={22} aria-hidden="true" /><h3>Make space for each other.</h3></div>{result.sharedRules.map((rule, index) => <div className="result-rule" key={`${index}-${rule}`}><span>{index + 1}</span><p>{rule}</p></div>)}</section>}
          {result.reflection && <ConversationReflection reflection={result.reflection} />}
        </> : <Notice>Your personal summary is unavailable for this conversation. You can still view the shared details and add a check-in.</Notice>}
      </section>
      <aside className="result-sidebar">
        <section className="dashboard-card journal-entry-details">
          <p className="eyebrow">Shared details</p><h2>{topicName(entry.topic)}</h2>
          <dl><div><dt>Started</dt><dd>{date(entry.startedAt)}</dd></div><div><dt>Both ready</dt><dd>{entry.bothReadyAt ? date(entry.bothReadyAt) : 'Not yet'}</dd></div><div><dt>Your check-in</dt><dd>{(couple?.partnerRole === 'A' ? entry.ratingA : entry.ratingB) ?? 'Not rated'}</dd></div><div><dt>Partner’s check-in</dt><dd>{(couple?.partnerRole === 'A' ? entry.ratingB : entry.ratingA) ?? 'Not rated'}</dd></div><div><dt>Shared rating</dt><dd>{entry.averageRating === null ? 'Not rated' : `${entry.averageRating} / 10`}</dd></div></dl>
          {entry.divergenceFlag && <p className="journal-entry-divergence">Your ratings differ. It may help to check in about how each of you felt.</p>}
          {entry.bothReadyAt ? <Link className="button button-primary" to={`/journal/${entry.id}/rating`}>Check in<ArrowRight size={18} /></Link> : <p className="quiet">Check-ins open when you have both finished preparing.</p>}
        </section>
        {result && result.thermometerStart !== null && <section className="thermometer-result"><h2>Your intensity check-in</h2>{result.thermometerEnd !== null
          ? <><div className="thermometer-comparison"><div><strong>{result.thermometerStart}</strong><span>Before</span></div><ArrowRight size={24} aria-hidden="true" /><div><strong>{result.thermometerEnd}</strong><span>After</span></div></div><p>Before and after preparing, on a scale of 1–10.</p></>
          : <><div className="thermometer-initial"><strong>{result.thermometerStart}<span>/ 10</span></strong><span>Starting intensity</span></div><p>No closing intensity was recorded.</p></>}</section>}
        <p className="result-privacy"><ShieldCheck size={17} aria-hidden="true" /><span>Your partner sees their own summary when they open this conversation. Your private answers are not included.</span></p>
      </aside>
    </div>}
  </Page>;
}

export function RatingPage() {
  const { recordId } = useParams();
  const { couple } = useSession();
  const navigate = useNavigate();
  const cache = useQueryClient();
  const [rating, setRating] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const query = useQuery({ queryKey: ['journal', couple?.coupleId, couple?.partnerRole], queryFn: ({ signal }) => api<Journal>('/journal', undefined, { signal }) });
  const record = query.data?.find(item => item.id === recordId);
  async function save(value: number | null) {
    if (request.current || !record) return;
    const controller = new AbortController(); request.current = controller; setBusy(true); setError('');
    try {
      await api(`/journal/${record.id}/rating`, { rating: value }, { signal: controller.signal });
      await cache.invalidateQueries({ queryKey: ['journal'] });
      await cache.invalidateQueries({ queryKey: ['stats'] });
      await cache.invalidateQueries({ queryKey: ['journal-entry'] });
      if (!controller.signal.aborted) navigate('/journal');
    } catch (reason) { if (!controller.signal.aborted) setError(errorMessage(reason)); }
    finally { request.current = null; if (!controller.signal.aborted) setBusy(false); }
  }
  return <Page className="rating-page" eyebrow="Your check-in" title="How did the conversation feel?" description={record ? `${topicName(record.topic)} · ${date(record.startedAt)}` : 'Reflect on how it went for you.'} aside={<div className="rating-aside"><span className="feature-icon feature-icon-partner"><HeartHandshake size={27} /></span><h2>It’s a check-in, not a scorecard.</h2><p>There’s no right answer. Notice how you felt, and leave room for your partner to feel differently.</p><Link className="text-link" to="/journal">Back to your journal<ArrowUpRight size={17} /></Link></div>}>
    {query.isPending ? <Loading /> : query.error ? <AccessNotice error={query.error} retry={() => void query.refetch()} /> : !record ? <Notice>This conversation is unavailable.<Link to="/journal">Return to journal</Link></Notice> : <div className="rating-content"><span className="privacy-pill"><UserRound size={14} />Your experience</span><p>Your rating reflects your experience. Your partner can add theirs separately.</p><Scale value={rating} onChange={setRating} disabled={busy} tone="rating" /><div className="scale-labels"><span>Still felt difficult</span><span>Felt understood</span></div>{error && <Notice kind="error">{error}</Notice>}<div className="rating-actions"><Button disabled={busy || rating === null} onClick={() => void save(rating)}>{busy ? 'Saving…' : 'Save rating'}<ArrowRight size={18} /></Button><Button disabled={busy} variant="secondary" onClick={() => void save(null)}>We haven’t talked yet</Button></div><div className="rating-help"><CircleHelp size={17} /><span>You can come back and change your check-in later.</span></div></div>}
  </Page>;
}

export function SettingsPage() {
  const { couple, forget } = useSession();
  const navigate = useNavigate();
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function remove() {
    if (busy) return;
    setBusy(true); setError('');
    try { await api('/couples/me', undefined, { method: 'DELETE' }); forget(); navigate('/', { replace: true }); }
    catch (reason) { setError(errorMessage(reason)); setBusy(false); }
  }
  return <Page className="settings-page" layout="wide" eyebrow="Your settings" title="Your space. Your data." description="A private place to prepare, with you in control of what stays.">
    <div className="settings-grid">
      <section className="settings-section dashboard-card"><span className="feature-icon feature-icon-partner"><ShieldCheck size={26} /></span><h2>About this session</h2><span className="session-role"><span className="person-badge person-you"><UserRound size={17} /></span>Partner {couple?.partnerRole}</span><p>You’re using the browser for partner {couple?.partnerRole}. Keep this browser to return to your own preparation. Your partner needs a separate browser profile.</p><p className="quiet">When history storage is enabled, completed summaries and journal entries remain available after a server restart. Unfinished preparations are not saved across restarts. Keep your browser cookies to retain access.</p></section>
      <section className="settings-section dashboard-card"><span className="feature-icon feature-icon-soft"><LockKeyhole size={26} /></span><h2>Private by design</h2><p>Your private answers belong to your preparation. The journal shares the topic, dates, and check-ins. When you open a past conversation, only your own personal summary is shown to you.</p><div className="settings-privacy-note"><HeartHandshake size={22} /><p>You can understand each other without sharing every word you write here.</p></div></section>
      <section className="settings-section settings-delete dashboard-card"><div><h2>Delete your couple’s data</h2><p>This removes both partners’ profiles, preparations, and journal entries from Kintsugi. You won’t be able to undo it.</p><p className="quiet">This does not cancel a Stripe subscription or delete records held by an external provider.</p></div><Button variant="secondary" className="danger-button" onClick={() => dialog.current?.showModal()}><Trash2 size={17} />Delete everything</Button></section>
    </div>
    <dialog ref={dialog} className="confirm-dialog" onCancel={event => { if (busy) event.preventDefault(); }}><span className="feature-icon"><Trash2 size={24} /></span><h2>Delete everything for both of you?</h2><p>Both partners’ Kintsugi data will be removed. This cannot be undone.</p>{error && <Notice kind="error">{error}</Notice>}<div className="actions"><Button className="danger-button" disabled={busy} onClick={() => void remove()}>{busy ? 'Deleting…' : 'Yes, delete everything'}</Button><Button disabled={busy} variant="text" onClick={() => dialog.current?.close()}>Cancel</Button></div></dialog>
  </Page>;
}
