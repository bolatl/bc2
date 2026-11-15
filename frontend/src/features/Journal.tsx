import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ArrowUpRight, BookOpen, Check, CircleHelp, Copy, Flower2, HeartHandshake, LockKeyhole, MessageCircle, MessageCircleHeart, RefreshCw, ShieldCheck, Sparkles, Trash2, TrendingUp, UserRound, UsersRound } from 'lucide-react';
import { api, ApiError, errorMessage } from '../api/client';
import type { Couple, Fight, FightRecord, Journal, JournalEntry, Personality, Stats, Subscription } from '../api/types';
import { useSession } from '../app/session';
import { Button, Loading, Notice, Page, Scale } from '../components/ui';
import { LockedPreview } from '../components/LockedPreview';
import { ConversationReflection } from '../components/ConversationReflection';
import '../styles/journal.css';

export function topicName(topic: string) { return ({ money: 'Money', chores: 'Sharing the chores', kids: 'Parenting', family: 'Family', phone: 'Phone time', jealousy: 'Jealousy', closeness: 'Feeling close', plans_decisions: 'Plans and decisions', time_attention: 'Time and attention', other: 'Something on your mind' } as Record<string, string>)[topic] ?? topic; }
function date(value: string) { return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }

function SpaceSwitch({ active }: { active: 'you' | 'partner' }) {
  return <nav className="space-switch" aria-label="Personal and partner views"><Link to="/home" aria-current={active === 'you' ? 'page' : undefined}><UserRound size={16} />Your space</Link><Link to="/partner" aria-current={active === 'partner' ? 'page' : undefined}><UsersRound size={16} />Your partner</Link></nav>;
}

function partnerState(couple: Couple) {
  if (couple.partnerRole === 'B') return couple.partnerBStatus === 'not_invited'
    ? { title: 'Waiting for the next invitation', description: 'Your partner has not shared their next preparation yet.', ready: false }
    : { title: 'Ready to talk', description: 'Your partner has finished their preparation for this conversation. Take the time you need for your own.', ready: true };
  return {
    not_invited: { title: 'Invitation not ready yet', description: 'Finish your preparation to make an invitation available for your partner.', ready: false },
    invited: { title: 'Ready to be invited', description: 'Your invitation is ready. Share it when you feel comfortable; your partner will prepare in their own space.', ready: false },
    in_progress: { title: 'Preparing privately', description: 'Your partner has joined and is preparing their side. Their answers and personal summary stay private.', ready: false },
    ready: { title: 'Ready to talk', description: 'Your partner has finished their preparation. You can bring your own words into the conversation together.', ready: true },
  }[couple.partnerBStatus];
}

function useCurrentPreparation() {
  const { couple } = useSession();
  return useQuery({ queryKey: ['home-fight', couple?.coupleId, couple?.partnerRole, couple?.currentSessionId], queryFn: ({ signal }) => api<Fight>(`/fight-sessions/${couple!.currentSessionId}`, undefined, { signal }), enabled: !!couple?.currentSessionId });
}

export function HomePage() {
  const { couple, refresh } = useSession();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const current = useCurrentPreparation();
  const status = current.data?.status;
  const completed = status === 'completed';
  const waiting = completed && (couple?.partnerRole === 'B' || couple?.partnerBStatus !== 'ready');
  const active = status === 'in_progress' || status === 'awaiting_payment';
  const waitingForA = couple?.partnerRole === 'B' && !couple.currentSessionId && couple.partnerBStatus === 'not_invited';
  async function start() {
    if (busy || request.current) return;
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError('');
    try {
      const fight = await api<Fight>('/fight-sessions', {}, { signal: controller.signal });
      await refresh();
      if (!controller.signal.aborted) navigate(`/fight-sessions/${fight.sessionId}`);
    } catch (reason) {
      if (controller.signal.aborted) return;
      if (reason instanceof ApiError && reason.status === 402) { navigate('/paywall'); return; }
      try {
        const found = await refresh();
        if (found?.currentSessionId && found.currentSessionId !== couple?.currentSessionId) { navigate(`/fight-sessions/${found.currentSessionId}`); return; }
      } catch { /* The original failure remains useful. */ }
      setError(errorMessage(reason));
    } finally { request.current = null; if (!controller.signal.aborted) setBusy(false); }
  }
  const ownStatus = couple?.currentSessionId && current.isPending ? 'Checking your preparation…' : current.error ? 'Unable to check' : completed ? 'Ready to talk' : active ? 'Preparing privately' : 'Ready when you are';
  const partner = couple ? partnerState(couple) : null;
  return <Page className="dashboard-page personal-space-page" layout="wide" eyebrow="A moment for you" title={active ? 'Continue at your own pace.' : completed ? 'Your words are ready.' : 'A little space to understand.'} description="Prepare privately. Find your words. Come back to each other.">
    <SpaceSwitch active="you" />
    <div className="personal-home-grid">
      <div className="home-primary">
        {waitingForA ? <div className="home-action home-action-waiting"><span className="feature-icon"><MessageCircleHeart size={28} /></span><p className="eyebrow">Your next conversation</p><h2>Give them a little room.</h2><p>Your partner is preparing for your next conversation. Your own preparation will be available when they are ready.</p><Button variant="secondary" onClick={() => void refresh().catch(() => undefined)}><RefreshCw size={17} />Check again</Button></div>
          : couple?.currentSessionId && current.isPending ? <div className="dashboard-card"><Loading /></div>
          : current.error ? <Notice kind="error">{errorMessage(current.error)} <Button variant="text" onClick={() => void current.refetch()}>Try again</Button></Notice>
          : <div className="home-action">
            <div className="home-action-top"><span className="feature-icon"><Flower2 size={30} strokeWidth={1.3} aria-hidden="true" /></span><span className="privacy-pill"><LockKeyhole size={13} />Only you</span></div>
            <p className="eyebrow">Your private preparation</p>
            <h2>{active ? 'Pick up your conversation' : completed ? 'Keep your first sentence close' : 'Start with what matters to you'}</h2>
            <p>{active ? 'Your current step is waiting. Take a breath, and continue with what feels true for you.' : completed ? 'Revisit your personal guide before you talk. There is room for both of your perspectives.' : 'A few guided questions can help you understand what happened, what you felt, and what you need.'}</p>
            <div className="actions">{active || completed ? <Link className="button button-primary" to={`/fight-sessions/${couple?.currentSessionId}${completed ? '/result' : ''}`}>{completed ? 'View your guide' : 'Continue conversation'}<ArrowRight size={18} /></Link> : <Button disabled={busy} onClick={() => void start()}>{busy ? 'Getting ready…' : 'Start a conversation'}<ArrowRight size={18} /></Button>}
              {completed && !waiting && <Button disabled={busy} variant="text" onClick={() => void start()}>Start another conversation</Button>}
            </div>
          </div>}
        {error && <Notice kind="error">{error}</Notice>}
      </div>
      <aside className="personal-pair-card dashboard-card">
        <div className="personal-card-heading"><UsersRound size={21} /><h2>Where you both are</h2></div>
        <div className="partner-status-row"><span className="person-badge person-you"><UserRound size={18} /></span><div><b>You</b><span>{ownStatus}</span></div>{completed && <Check size={17} className="ready-check" />}</div>
        <div className="partner-status-row"><span className="person-badge person-partner"><UserRound size={18} /></span><div><b>Your partner</b><span>{partner?.title}</span></div>{partner?.ready && <Check size={17} className="ready-check" />}</div>
        <p>You each have your own space. Only your readiness is shared.</p>
        <Link className="text-link" to="/partner">View partner’s progress<ArrowUpRight size={16} /></Link>
      </aside>
    </div>
    <div className="home-links personal-home-links">
      <Link className="dashboard-link" to="/journal"><span className="feature-icon feature-icon-partner"><BookOpen size={24} strokeWidth={1.4} /></span><span><strong>Your shared journal</strong><span>Look back at your conversations and check in on how they felt.</span></span><ArrowUpRight size={20} /></Link>
      <Link className="dashboard-link" to="/profile"><span className="feature-icon feature-icon-soft"><UserRound size={24} strokeWidth={1.4} /></span><span><strong>My profile</strong><span>{couple?.personalityDone ? 'Revisit your personal reflection, your plan, and privacy settings.' : 'Get to know your patterns, and manage your personal space.'}</span></span><ArrowUpRight size={20} /></Link>
    </div>
  </Page>;
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
  return <Page className="partner-space-page personal-space-page" layout="wide" eyebrow="Your shared space" title="Two perspectives. Room for both." description="See where your partner is, while giving each other space to prepare.">
    <SpaceSwitch active="partner" />
    <div className="partner-space-grid">
      <section className="partner-preparation-card dashboard-card">
        <div className="partner-view-label"><span className="person-badge person-partner"><UserRound size={24} /></span><div><span className="eyebrow">Your partner</span><p>Preparation status</p></div><span className={`readiness-badge ${partner?.ready ? 'is-ready' : ''}`}>{partner?.ready ? <Check size={14} /> : <Flower2 size={15} />}{partner?.ready ? 'Ready' : 'In their own time'}</span></div>
        <h2>{partner?.title}</h2><p className="partner-state-description">{partner?.description}</p>
        {couple?.partnerRole === 'A' && <ol className="partner-progress" aria-label="Your partner’s preparation progress">{['Invite ready', 'Preparing', 'Ready to talk'].map((label, index) => {
          const reached = { not_invited: -1, invited: 0, in_progress: 1, ready: 2 }[couple.partnerBStatus];
          return <li key={label} className={index <= reached ? 'reached' : ''} aria-current={index === reached ? 'step' : undefined}>{label}</li>;
        })}</ol>}
        <div className="pair-readiness" aria-label="Both partners’ readiness"><div><span className={`person-badge person-you ${ownReady ? 'is-ready' : ''}`}>{ownReady ? <Check size={24} /> : <UserRound size={24} />}</span><strong>You</strong><span>{couple?.currentSessionId && current.isPending ? 'Checking…' : current.error ? 'Unable to check' : ownReady ? 'Ready to talk' : 'Your own preparation'}</span></div><span className="pair-readiness-connection" aria-hidden="true"><Flower2 size={21} /></span><div><span className={`person-badge person-partner ${partner?.ready ? 'is-ready' : ''}`}>{partner?.ready ? <Check size={24} /> : <UserRound size={24} />}</span><strong>Your partner</strong><span>{partner?.ready ? 'Ready to talk' : 'Not ready yet'}</span></div></div>
        <div className="actions">{couple?.partnerRole === 'A' && couple.inviteUrl && <Button onClick={() => void copy()}>{copied ? <Check size={17} /> : <Copy size={17} />}{copied ? 'Link copied' : 'Copy invite link'}</Button>}<Button variant="secondary" disabled={checking} onClick={() => void check()}><RefreshCw size={16} />{checking ? 'Checking…' : 'Refresh status'}</Button></div>
        {copyError && <label className="form-field invite-copy-field">Copy this link to share<input readOnly value={couple?.inviteUrl || ''} onFocus={event => event.currentTarget.select()} /></label>}
        {error && <Notice kind="error">{error}</Notice>}
      </section>
      <aside className="partner-space-aside">
        <section className="partner-privacy-card"><LockKeyhole size={22} strokeWidth={1.4} /><h2>A little privacy helps you be honest.</h2><p>This view shares readiness, not your partner’s answers, personality reflection, or personal summary.</p><Link className="text-link" to="/home">Return to your own space<ArrowUpRight size={16} /></Link></section>
        <Link className="dashboard-link partner-journal-link" to="/journal"><BookOpen size={23} strokeWidth={1.4} /><span><strong>Your shared journal</strong><span>Once you have both prepared, your conversation appears here.</span></span><ArrowUpRight size={18} /></Link>
      </aside>
    </div>
  </Page>;
}

export function ProfilePage() {
  const { couple } = useSession();
  const profile = useQuery({ queryKey: ['profile-reflection', couple?.coupleId, couple?.partnerRole], queryFn: ({ signal }) => api<Personality>('/personality-tests/me', undefined, { signal }), enabled: Boolean(couple?.personalityDone) });
  const plan = useQuery({ queryKey: ['profile-subscription', couple?.coupleId, couple?.partnerRole], queryFn: ({ signal }) => api<Subscription>('/subscriptions/me', undefined, { signal }), enabled: Boolean(couple) });
  const planTitles = { monthly: 'Monthly plan', yearly: 'Yearly plan', program: 'Couples program' };
  const planStatus = plan.data?.status;
  return <Page className="profile-page personal-space-page" layout="wide" eyebrow="My profile" title="Your space, made personal." description="Your reflection, your access, and the things you choose to keep.">
    <div className="profile-workspace">
      <aside className="profile-identity-card dashboard-card"><span className="profile-avatar"><UserRound size={34} strokeWidth={1.2} /></span><h2>You</h2><span className="profile-role">Partner {couple?.partnerRole}</span><p>Your private Kintsugi profile in this browser.</p><dl><div><dt>Shared space created</dt><dd>{couple ? date(couple.createdAt) : '—'}</dd></div><div><dt>Personal reflection</dt><dd>{couple?.personalityDone ? 'Completed' : 'Not started'}</dd></div></dl><Link className="text-link" to="/home">Your conversations<ArrowUpRight size={16} /></Link></aside>
      <div className="profile-sections">
        <section className="profile-reflection-card dashboard-card"><div className="personal-card-heading"><Sparkles size={22} strokeWidth={1.4} /><div><p className="eyebrow">Your personal reflection</p><h2>A little more self-understanding.</h2></div></div>
          {couple?.personalityDone ? profile.isPending ? <Loading label="Opening your reflection…" /> : profile.error ? <Notice kind="error">{errorMessage(profile.error)}<Button variant="text" onClick={() => void profile.refetch()}>Try again</Button></Notice> : profile.data && <><p>From your reflection on {date(profile.data.completedAt)}. These are starting points for understanding yourself.</p><ul className="profile-strengths">{profile.data.strengths.map(strength => <li key={strength}><Flower2 size={16} /><span>{strength}</span></li>)}</ul><Link className="button button-secondary" to="/personality/result">View your full reflection<ArrowUpRight size={16} /></Link></> : <><p>Explore how you connect, react, and make room for each other with an optional 20-question reflection.</p><Link className="button button-secondary" to="/personality">Explore your patterns<ArrowRight size={17} /></Link></>}
        </section>
        <div className="profile-details-grid">
          <section className="profile-plan-card dashboard-card"><span className="feature-icon feature-icon-partner"><HeartHandshake size={23} strokeWidth={1.4} /></span><h2>Your shared plan</h2>{plan.isPending ? <Loading label="Checking your plan…" /> : plan.error ? <Notice kind="error">{errorMessage(plan.error)}<Button variant="text" onClick={() => void plan.refetch()}>Try again</Button></Notice> : <><p className="profile-plan-status">{planStatus === 'active' ? 'Full access is active' : planStatus === 'pending' ? 'Checkout is waiting' : 'No active plan'}</p><p>{planStatus === 'active' ? `${plan.data?.activatedAt ? planTitles[plan.data.plan] + '. ' : ''}Your couple can access full preparations, your journal, and shared check-ins.` : planStatus === 'pending' ? 'Finish your existing checkout to open full access for both of you.' : 'One plan opens full preparations and your shared journal for both partners.'}</p>{planStatus !== 'active' && (couple?.partnerRole === 'A' ? <Link className="text-link" to="/paywall">{planStatus === 'pending' ? 'Resume checkout' : 'View plans'}<ArrowUpRight size={16} /></Link> : <p className="quiet">Your partner manages your couple’s plan.</p>)}</>}</section>
          <section className="profile-settings-card dashboard-card"><span className="feature-icon feature-icon-soft"><ShieldCheck size={23} strokeWidth={1.4} /></span><h2>Privacy &amp; your data</h2><p>Your personal answers and reflection stay private from your partner. Keep this browser’s cookies to return to your profile.</p><Link className="text-link" to="/settings">Manage your data<ArrowUpRight size={16} /></Link></section>
        </div>
      </div>
    </div>
  </Page>;
}

function AccessNotice({ error, retry, variant = 'journal' }: { error: unknown; retry: () => void; variant?: 'journal' | 'patterns' }) {
  const { couple } = useSession();
  if (error instanceof ApiError && error.status === 402) return <LockedPreview variant={variant} title={variant === 'patterns' ? 'See your patterns over time.' : 'A place for your conversations.'} description={couple?.partnerRole === 'A' ? 'Your couple’s plan includes a shared journal, personal conversation guides, and check-ins over time.' : 'This part of your shared space opens when your partner activates a plan.'} action={couple?.partnerRole === 'A' ? <Link className="button button-primary" to="/paywall">View plans<ArrowRight size={18} /></Link> : <Link className="button button-secondary" to="/home">Return to your space<ArrowRight size={18} /></Link>} />;
  return <Notice kind="error">{errorMessage(error)}<Button variant="text" onClick={retry}>Try again</Button></Notice>;
}

export function JournalPage() {
  const { couple } = useSession();
  const query = useQuery({ queryKey: ['journal', couple?.coupleId, couple?.partnerRole], queryFn: ({ signal }) => api<Journal>('/journal', undefined, { signal }) });
  const records = query.data ?? [];
  const rated = records.filter(record => record.averageRating !== null);
  return <Page className="journal-page" layout="wide" eyebrow="Your shared journal" title="Every conversation is a beginning." description="Keep a little perspective on what you’ve talked about, and how it felt.">
    <div className="subnav"><span><BookOpen size={17} />Conversations</span><Link to="/stats"><TrendingUp size={17} />Patterns<ArrowUpRight size={15} /></Link></div>
    {query.isPending ? <Loading /> : query.error ? <AccessNotice error={query.error} retry={() => void query.refetch()} /> : !records.length ? <div className="journal-empty dashboard-card"><span className="feature-icon feature-icon-partner"><BookOpen size={34} strokeWidth={1.5} /></span><h2>Your story starts with a conversation.</h2><p>Once you have both prepared, your conversation will appear here. Your private answers stay private.</p><Link className="button button-primary" to="/home">Go to your space<ArrowRight size={18} /></Link></div> : <>
      <div className="journal-summary"><div><span>Conversations together</span><strong>{records.length}</strong></div><div><span>Shared check-ins</span><strong>{rated.length}</strong></div><div><span>Rated 8 or higher</span><strong>{rated.filter(record => record.averageRating! >= 8).length}</strong></div></div>
      <div className="journal-workspace">
        <div className="journal-list dashboard-card"><div className="journal-list-heading"><h2>Your conversations</h2><span>Most recent first</span></div>{[...records].reverse().map(record => <JournalRow key={record.id} record={record} />)}</div>
        <aside className="journal-aside"><div className="dashboard-card journal-guide"><span className="feature-icon feature-icon-partner"><HeartHandshake size={24} /></span><h2>A shared view.</h2><p>Your journal brings both check-ins together. Each shared score is the average of your two ratings.</p><RatingLegend /><Link className="text-link" to="/stats">See your patterns<ArrowUpRight size={17} /></Link></div><div className="journal-privacy"><LockKeyhole size={17} /><p>Only the topic, dates, and check-ins are shared here. Your private preparation stays private.</p></div></aside>
      </div>
    </>}
  </Page>;
}
function RatingLegend() {
  return <div className="rating-legend" aria-label="Shared rating colors"><span><i className="status-dot green" />8–10</span><span><i className="status-dot yellow" />5–7.5</span><span><i className="status-dot red" />1–4.5</span><span><i className="status-dot gray" />No shared rating</span></div>;
}
function JournalRow({ record }: { record: FightRecord }) {
  const status = record.status === 'not_discussed' ? 'Not talked yet' : record.status === 'pending' ? 'Waiting for both check-ins' : 'Both checked in';
  return <article className="journal-row"><span className={`journal-topic-icon rating-${record.color}`}><MessageCircle size={20} /></span><div className="journal-row-copy"><p className="quiet">{date(record.startedAt)}</p><h2>{topicName(record.topic)}</h2><Link className="text-link journal-summary-link" to={`/journal/${record.id}`}>View your summary<ArrowUpRight size={16} /></Link><p className="record-status"><span className={`status-dot ${record.color}`} />{status}</p>{record.divergenceFlag && <p className="divergence-note">You see this one differently — worth a short check-in.</p>}</div><div className="journal-rating">{record.averageRating !== null ? <span className={`rating-value rating-${record.color}`}><strong>{record.averageRating}</strong><small> / 10 together</small></span> : <span className="quiet">No shared rating yet</span>}<Link className="text-link" to={`/journal/${record.id}/rating`}>Check in<ArrowUpRight size={17} /></Link></div></article>;
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
          <Link className="button button-primary" to={`/journal/${entry.id}/rating`}>Check in<ArrowRight size={18} /></Link>
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

export function StatsPage() {
  const { couple } = useSession();
  const query = useQuery({ queryKey: ['stats', couple?.coupleId, couple?.partnerRole], queryFn: ({ signal }) => api<Stats>('/journal/stats', undefined, { signal }) });
  const data = query.data;
  return <Page className="patterns-page" layout="wide" eyebrow="Your patterns" title="A little perspective over time." description="Some things get easier to understand when you look at them together.">
    <div className="subnav"><Link to="/journal"><BookOpen size={17} />Conversations</Link><span><TrendingUp size={17} />Patterns</span></div>
    {query.isPending ? <Loading /> : query.error ? <AccessNotice error={query.error} retry={() => void query.refetch()} variant="patterns" /> : data && data.totalFights === 0 ? <div className="journal-empty dashboard-card"><span className="feature-icon feature-icon-partner"><TrendingUp size={30} /></span><h2>There’s no pattern to show just yet.</h2><p>After you both prepare for a conversation, you’ll start to see your shared history here.</p><Link className="button button-primary" to="/home">Back to your space<ArrowRight size={18} /></Link></div> : data && <>
      <div className="patterns-grid">
        <div className="patterns-overview"><div className="stat-line"><span className="feature-icon"><MessageCircleHeart size={25} /></span><strong>{data.totalFights}</strong><span>conversations<br />in your journal</span><p>Each one is a chance to understand each other a little better.</p></div>
          {data.recurringTopicHint && <div className="recurring-topic"><span className="eyebrow">A recurring topic</span><h2>{topicName(data.recurringTopicHint)}</h2><p>This has come up in several conversations. It may be worth making a little time for it.</p><Link className="text-link" to="/home">Return to your space<ArrowUpRight size={16} /></Link></div>}
        </div>
        <section className="patterns-trend dashboard-card"><div className="card-heading"><span className="feature-icon feature-icon-partner"><TrendingUp size={22} /></span><div><h2>How conversations have felt</h2><p>Your shared ratings, in conversation order.</p></div></div>{!data.averageRatingTrend.length ? <div className="chart-empty"><p>Your trend will appear after you both add a numeric rating.</p><Link className="text-link" to="/journal">Add your check-in<ArrowUpRight size={16} /></Link></div> : <><RatingTrend ratings={data.averageRatingTrend} /><RatingLegend /><p className="chart-caption">Average ratings, in conversation order: {data.averageRatingTrend.join(' · ')} / 10</p></>}</section>
        <section className="patterns-topics dashboard-card"><div className="card-heading"><span className="feature-icon feature-icon-soft"><MessageCircle size={22} /></span><div><h2>What’s been on your minds</h2><p>The topics in your shared journal.</p></div></div><div className="topic-bars">{Object.entries(data.topicCounts).sort((a,b) => b[1]-a[1]).map(([topic, count]) => <div key={topic}><div className="bar-label"><span>{topicName(topic)}</span><span>{count} {count === 1 ? 'conversation' : 'conversations'}</span></div><div className="bar-track"><div style={{ width: `${count / data.totalFights * 100}%` }} /></div></div>)}</div></section>
      </div>
    </>}
  </Page>;
}
function RatingTrend({ ratings }: { ratings: number[] }) {
  const x = (i: number) => ratings.length === 1 ? 316 : 40 + i / (ratings.length - 1) * 550;
  const y = (value: number) => 178 - (value - 1) / 9 * 155;
  return <svg className="trend-chart" viewBox="0 0 620 205" role="img" aria-label={`Average ratings in order: ${ratings.join(', ')}`}>
    {[1, 5, 8, 10].map(value => <g key={value}><line x1="40" x2="590" y1={y(value)} y2={y(value)} className="chart-gridline" /><text x="16" y={y(value) + 4} className="chart-label">{value}</text></g>)}
    <polyline points={ratings.map((value, i) => `${x(i)},${y(value)}`).join(' ')} fill="none" className="chart-line" strokeWidth="2.5" strokeLinejoin="round" />
    {ratings.map((value, i) => <circle key={i} cx={x(i)} cy={y(value)} r="5.5" className={`chart-point ${value >= 8 ? 'green' : value >= 5 ? 'yellow' : 'red'}`}><title>Shared rating {i + 1}: {value} out of 10</title></circle>)}
  </svg>;
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
