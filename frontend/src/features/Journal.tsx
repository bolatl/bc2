import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ArrowUpRight, BookOpen, Check, CircleHelp, HeartHandshake, LockKeyhole, MessageCircle, MessageCircleHeart, RefreshCw, ShieldCheck, Sparkles, Trash2, TrendingUp, UserRound } from 'lucide-react';
import { api, ApiError, errorMessage } from '../api/client';
import type { Fight, FightRecord, Journal, Stats } from '../api/types';
import { useSession } from '../app/session';
import { Button, Loading, Notice, Page, Scale } from '../components/ui';
import '../styles/journal.css';

export function topicName(topic: string) { return ({ money: 'Money', chores: 'Sharing the chores', kids: 'Parenting', family: 'Family', phone: 'Phone time', jealousy: 'Jealousy', closeness: 'Feeling close', plans_decisions: 'Plans and decisions', time_attention: 'Time and attention', other: 'Something on your mind' } as Record<string, string>)[topic] ?? topic; }
function date(value: string) { return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }

export function HomePage() {
  const { couple, refresh } = useSession();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const current = useQuery({ queryKey: ['home-fight', couple?.coupleId, couple?.partnerRole, couple?.currentSessionId], queryFn: ({ signal }) => api<Fight>(`/fight-sessions/${couple!.currentSessionId}`, undefined, { signal }), enabled: !!couple?.currentSessionId });
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
  const ownStatus = couple?.currentSessionId && current.isPending ? 'Checking your preparation…' : completed ? 'Ready to talk' : active ? 'Preparing privately' : 'Ready when you are';
  const partnerStatus = couple?.partnerRole === 'A'
    ? ({ not_invited: 'An invitation comes after your preparation', invited: 'Your invitation is ready to share', in_progress: 'Preparing their side privately', ready: 'Ready to talk' }[couple.partnerBStatus])
    : waitingForA ? 'Preparing their side privately' : 'Ready to talk';
  return <Page className="dashboard-page" layout="wide" eyebrow="Your space" title={active ? 'Pick up where you left off.' : completed ? 'A little understanding goes a long way.' : 'What’s on your mind?'} description="A little space to find your words. A better way to hear each other.">
    <div className="home-workspace">
      <div className="home-primary">
        {waitingForA ? <div className="home-action home-action-waiting"><span className="feature-icon"><MessageCircleHeart size={28} /></span><p className="eyebrow">Your next conversation</p><h2>Give them a little room.</h2><p>Your partner is preparing for your next conversation. Your own preparation will be available when they are ready.</p><Button variant="secondary" onClick={() => void refresh().catch(() => undefined)}><RefreshCw size={17} />Check again</Button></div>
          : couple?.currentSessionId && current.isPending ? <div className="dashboard-card"><Loading /></div>
          : current.error ? <Notice kind="error">{errorMessage(current.error)} <Button variant="text" onClick={() => void current.refetch()}>Try again</Button></Notice>
          : <div className="home-action">
            <div className="home-action-top"><span className="feature-icon"><MessageCircleHeart size={28} aria-hidden="true" /></span><span className="privacy-pill"><LockKeyhole size={13} />Just for you</span></div>
            <p className="eyebrow">Your private preparation</p>
            <h2>{active ? 'Your conversation is waiting' : completed ? 'Your words are ready' : 'Start with your side'}</h2>
            <p>{active ? 'Your thoughts are saved. Come back to the same step and take it at your own pace.' : completed ? 'Keep your first sentence close. Revisit your guide before you talk to each other.' : 'What happened, what hurt, and what you need. We’ll help you turn it into words you can share.'}</p>
            <div className="actions">{active || completed ? <Link className="button button-primary" to={`/fight-sessions/${couple?.currentSessionId}${completed ? '/result' : ''}`}>{completed ? 'View your guide' : 'Continue conversation'}<ArrowRight size={18} /></Link> : <Button disabled={busy} onClick={() => void start()}>{busy ? 'Getting ready…' : 'Start a conversation'}<ArrowRight size={18} /></Button>}
              {completed && !waiting && <Button disabled={busy} variant="text" onClick={() => void start()}>Start another conversation</Button>}
            </div>
          </div>}
        {error && <Notice kind="error">{error}</Notice>}
      </div>
      <aside className="home-partners dashboard-card">
        <span className="feature-icon feature-icon-partner"><HeartHandshake size={25} /></span>
        <h2>Two sides. One conversation.</h2>
        <p>You each prepare separately. Your private answers stay your own.</p>
        <div className="partner-status-row"><span className="person-badge person-you"><UserRound size={18} /></span><div><b>You</b><span>{ownStatus}</span></div>{completed && <Check size={18} className="ready-check" />}</div>
        <div className="partner-status-row"><span className="person-badge person-partner"><UserRound size={18} /></span><div><b>Your partner</b><span>{partnerStatus}</span></div></div>
        {waiting && <p className="partner-next-note">{couple?.partnerRole === 'A' ? 'Open your guide to share the invitation whenever you’re ready.' : 'You have finished your preparation for this conversation.'}</p>}
      </aside>
    </div>
    <div className="home-links">
      <Link className="dashboard-link" to="/journal"><span className="feature-icon feature-icon-partner"><BookOpen size={24} /></span><span><strong>Your shared journal</strong><span>Look back at the conversations you’ve had and how they felt.</span></span><ArrowUpRight size={22} /></Link>
      <Link className="dashboard-link" to={couple?.personalityDone ? '/personality/result' : '/personality'}><span className="feature-icon feature-icon-soft"><Sparkles size={24} /></span><span><strong>{couple?.personalityDone ? 'Your personal profile' : 'Get to know your patterns'}</strong><span>{couple?.personalityDone ? 'Revisit your strengths and small things to try.' : 'An optional 20-question reflection on how you connect.'}</span></span><ArrowUpRight size={22} /></Link>
    </div>
  </Page>;
}

function AccessNotice({ error, retry }: { error: unknown; retry: () => void }) {
  const { couple } = useSession();
  if (error instanceof ApiError && error.status === 402) return <Notice>{couple?.partnerRole === 'A' ? <>Your shared journal is included with your couple’s plan.<div className="actions"><Link className="button button-primary" to="/paywall">View plans<ArrowRight size={18} /></Link></div></> : 'Your shared journal will be available after your partner activates a plan.'}</Notice>;
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
  return <article className="journal-row"><span className={`journal-topic-icon rating-${record.color}`}><MessageCircle size={20} /></span><div className="journal-row-copy"><p className="quiet">{date(record.startedAt)}</p><h2>{topicName(record.topic)}</h2><p className="record-status"><span className={`status-dot ${record.color}`} />{status}</p>{record.divergenceFlag && <p className="divergence-note">You see this one differently — worth a short check-in.</p>}</div><div className="journal-rating">{record.averageRating !== null ? <span className={`rating-value rating-${record.color}`}><strong>{record.averageRating}</strong><small> / 10 together</small></span> : <span className="quiet">No shared rating yet</span>}<Link className="text-link" to={`/journal/${record.id}/rating`}>Check in<ArrowUpRight size={17} /></Link></div></article>;
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
    {query.isPending ? <Loading /> : query.error ? <AccessNotice error={query.error} retry={() => void query.refetch()} /> : data && data.totalFights === 0 ? <div className="journal-empty dashboard-card"><span className="feature-icon feature-icon-partner"><TrendingUp size={30} /></span><h2>There’s no pattern to show just yet.</h2><p>After you both prepare for a conversation, you’ll start to see your shared history here.</p><Link className="button button-primary" to="/home">Back to your space<ArrowRight size={18} /></Link></div> : data && <>
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
      <section className="settings-section dashboard-card"><span className="feature-icon feature-icon-partner"><ShieldCheck size={26} /></span><h2>About this session</h2><span className="session-role"><span className="person-badge person-you"><UserRound size={17} /></span>Partner {couple?.partnerRole}</span><p>You’re using the browser for partner {couple?.partnerRole}. Keep this browser to return to your own preparation. Your partner needs a separate browser profile.</p><p className="quiet">This initial version stores data in server memory. Restarting the backend clears your session and journal.</p></section>
      <section className="settings-section dashboard-card"><span className="feature-icon feature-icon-soft"><LockKeyhole size={26} /></span><h2>Private by design</h2><p>Your private answers belong to your preparation. Your shared journal holds only the topic, dates, and check-ins.</p><div className="settings-privacy-note"><HeartHandshake size={22} /><p>You can understand each other without sharing every word you write here.</p></div></section>
      <section className="settings-section settings-delete dashboard-card"><div><h2>Delete your couple’s data</h2><p>This removes both partners’ profiles, preparations, and journal entries from Love Lab. You won’t be able to undo it.</p><p className="quiet">This does not cancel a Stripe subscription or delete records held by an external provider.</p></div><Button variant="secondary" className="danger-button" onClick={() => dialog.current?.showModal()}><Trash2 size={17} />Delete everything</Button></section>
    </div>
    <dialog ref={dialog} className="confirm-dialog" onCancel={event => { if (busy) event.preventDefault(); }}><span className="feature-icon"><Trash2 size={24} /></span><h2>Delete everything for both of you?</h2><p>Both partners’ Love Lab data will be removed. This cannot be undone.</p>{error && <Notice kind="error">{error}</Notice>}<div className="actions"><Button className="danger-button" disabled={busy} onClick={() => void remove()}>{busy ? 'Deleting…' : 'Yes, delete everything'}</Button><Button disabled={busy} variant="text" onClick={() => dialog.current?.close()}>Cancel</Button></div></dialog>
  </Page>;
}
