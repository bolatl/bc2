import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ArrowUpRight, BookOpen, MessageCircle, Trash2 } from 'lucide-react';
import { api, ApiError, errorMessage } from '../api/client';
import type { Fight, FightRecord, Journal, Stats } from '../api/types';
import { useSession } from '../app/session';
import { Button, Loading, Notice, Page, Scale } from '../components/ui';

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
  return <Page eyebrow="Your space" title={active ? 'Pick up where you left off.' : completed ? 'A little understanding goes a long way.' : 'What’s on your mind?'} description="Take a breath. There’s room to understand your side of the story, and theirs.">
    {waitingForA ? <Notice>Your partner is preparing for your next conversation. Your own preparation will be available when they are ready.<Button variant="text" onClick={() => void refresh().catch(() => undefined)}>Check again</Button></Notice> : couple?.currentSessionId && current.isPending ? <Loading /> : current.error ? <Notice kind="error">{errorMessage(current.error)} <Button variant="text" onClick={() => void current.refetch()}>Try again</Button></Notice> : <div className="home-action">
      <MessageCircle size={28} strokeWidth={1.4} aria-hidden="true" />
      <div><h2>{active ? 'Your conversation is waiting' : completed ? 'Your words are ready' : 'Start with your side'}</h2><p>{active ? 'Continue your private preparation at the same step.' : completed ? 'Revisit your first sentence and your conversation guide.' : 'A few questions to find what you feel, what you need, and how to begin.'}</p>
        <div className="actions">{active || completed ? <Link className="button button-primary" to={`/fight-sessions/${couple?.currentSessionId}${completed ? '/result' : ''}`}>{completed ? 'View your guide' : 'Continue conversation'}<ArrowRight size={18} /></Link> : <Button disabled={busy} onClick={() => void start()}>{busy ? 'Getting ready…' : 'Start a conversation'}<ArrowRight size={18} /></Button>}
        {completed && !waiting && <Button disabled={busy} variant="text" onClick={() => void start()}>Start another conversation</Button>}</div>
      </div>
    </div>}
    {error && <Notice kind="error">{error}</Notice>}
    {waiting && <p className="quiet">{couple?.partnerRole === 'A' ? 'Your partner can prepare in their own time. Open your guide to share the invitation.' : 'You have finished your preparation for this conversation.'}</p>}
    <div className="home-links"><Link className="choice-card" to="/journal"><span><BookOpen size={22} /><strong>Your shared journal</strong><span>A place to look back, together.</span></span><ArrowUpRight /></Link><Link className="choice-card" to={couple?.personalityDone ? '/personality/result' : '/personality'}><span><span className="profile-symbol" aria-hidden="true">Aa</span><strong>{couple?.personalityDone ? 'Your personal profile' : 'Get to know your patterns'}</strong><span>{couple?.personalityDone ? 'Revisit your strengths and suggestions.' : 'An optional 20-question reflection.'}</span></span><ArrowUpRight /></Link></div>
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
  return <Page eyebrow="Your shared journal" title="Every conversation is a beginning." description="Look back at what you’ve talked about and how it felt for each of you.">
    <div className="subnav"><span>Conversations</span><Link to="/stats">Patterns<ArrowUpRight size={16} /></Link></div>
    {query.isPending ? <Loading /> : query.error ? <AccessNotice error={query.error} retry={() => void query.refetch()} /> : !query.data?.length ? <div className="empty-state"><BookOpen size={36} strokeWidth={1.2} /><h2>Your story starts with a conversation.</h2><p>Once you have both prepared, your conversation will appear here. Your private answers stay private.</p><Link className="text-link" to="/home">Go to your space<ArrowRight size={18} /></Link></div> : <div className="journal-list">{[...query.data].reverse().map(record => <JournalRow key={record.id} record={record} />)}</div>}
  </Page>;
}
function JournalRow({ record }: { record: FightRecord }) {
  const status = record.status === 'not_discussed' ? 'Not talked yet' : record.status === 'pending' ? 'Waiting for both check-ins' : 'Both checked in';
  return <article className="journal-row"><div><p className="quiet">{date(record.startedAt)}</p><h2>{topicName(record.topic)}</h2><p className="record-status"><span className={`status-dot ${record.color}`} />{status}</p>{record.divergenceFlag && <p>You see this one differently — worth a short check-in.</p>}</div><div className="journal-rating">{record.averageRating !== null ? <span><strong>{record.averageRating}</strong><small> / 10 together</small></span> : <span className="quiet">No shared rating yet</span>}<Link className="text-link" to={`/journal/${record.id}/rating`}>Check in<ArrowUpRight size={17} /></Link></div></article>;
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
  return <Page eyebrow="Your check-in" title="How did the conversation feel?" description={record ? `${topicName(record.topic)} · ${date(record.startedAt)}` : 'Reflect on how it went for you.'}>
    {query.isPending ? <Loading /> : query.error ? <AccessNotice error={query.error} retry={() => void query.refetch()} /> : !record ? <Notice>This conversation is unavailable.<Link to="/journal">Return to journal</Link></Notice> : <div className="stack"><p>Your rating reflects your experience. Your partner can add theirs separately.</p><Scale value={rating} onChange={setRating} disabled={busy} /><div className="scale-labels"><span>Still felt difficult</span><span>Felt understood</span></div>{error && <Notice kind="error">{error}</Notice>}<div className="actions"><Button disabled={busy || rating === null} onClick={() => void save(rating)}>{busy ? 'Saving…' : 'Save rating'}<ArrowRight size={18} /></Button><Button disabled={busy} variant="text" onClick={() => void save(null)}>We haven’t talked yet</Button></div></div>}
  </Page>;
}

export function StatsPage() {
  const { couple } = useSession();
  const query = useQuery({ queryKey: ['stats', couple?.coupleId, couple?.partnerRole], queryFn: ({ signal }) => api<Stats>('/journal/stats', undefined, { signal }) });
  const data = query.data;
  return <Page eyebrow="Your patterns" title="A little perspective over time." description="A view of the conversations in your shared journal. Small steps count.">
    <div className="subnav"><Link to="/journal">Conversations</Link><span>Patterns</span></div>
    {query.isPending ? <Loading /> : query.error ? <AccessNotice error={query.error} retry={() => void query.refetch()} /> : data && data.totalFights === 0 ? <div className="empty-state"><h2>There’s no pattern to show just yet.</h2><p>After you both prepare for a conversation, you’ll start to see your shared history here.</p><Link className="text-link" to="/home">Back to your space<ArrowRight size={18} /></Link></div> : data && <>
      <div className="stat-line"><strong>{data.totalFights}</strong><span>conversations<br />in your journal</span></div>
      <section className="section-block"><h2>What’s been on your minds</h2><div className="topic-bars">{Object.entries(data.topicCounts).sort((a,b) => b[1]-a[1]).map(([topic, count]) => <div key={topic}><div className="bar-label"><span>{topicName(topic)}</span><span>{count}</span></div><div className="bar-track"><div style={{ width: `${count / data.totalFights * 100}%` }} /></div></div>)}</div></section>
      <section className="section-block"><h2>How conversations have felt</h2>{!data.averageRatingTrend.length ? <p className="quiet">Your trend will appear after you both add a numeric rating.</p> : <><svg className="trend-chart" viewBox="0 0 600 180" role="img" aria-label={`Average ratings in order: ${data.averageRatingTrend.join(', ')}`}><path d="M20 10V160H580" fill="none" stroke="#D8D8DC" /><polyline points={data.averageRatingTrend.map((value, i, all) => `${20 + i / Math.max(1, all.length-1) * 560},${160 - (value-1)/9*145}`).join(' ')} fill="none" stroke="#002FA7" strokeWidth="3" />{data.averageRatingTrend.map((value,i,all) => <circle key={i} cx={20+i/Math.max(1,all.length-1)*560} cy={160-(value-1)/9*145} r="4" fill="#002FA7" />)}</svg><p className="quiet">Average ratings, in conversation order: {data.averageRatingTrend.join(' · ')} / 10</p></>}</section>
      {data.recurringTopicHint && <Notice>{topicName(data.recurringTopicHint)} has come up in several conversations. It may be worth making a little time for it.</Notice>}
    </>}
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
  return <Page eyebrow="Your settings" title="Your space. Your data." description="Your private answers belong to your preparation. Your shared journal holds only the topic, dates, and check-ins.">
    <section className="settings-section"><h2>About this session</h2><p>You’re using the browser for partner {couple?.partnerRole}. Keep this browser to return to your own preparation. Your partner needs a separate browser profile.</p><p className="quiet">This initial version stores data in server memory. Restarting the backend clears your session and journal.</p></section>
    <section className="settings-section"><h2>Delete your couple’s data</h2><p>This removes both partners’ profiles, preparations, and journal entries from Love Lab. You won’t be able to undo it.</p><p className="quiet">This does not cancel a Stripe subscription or delete records held by an external provider.</p><Button variant="secondary" onClick={() => dialog.current?.showModal()}><Trash2 size={17} />Delete everything</Button></section>
    <dialog ref={dialog} className="confirm-dialog" onCancel={event => { if (busy) event.preventDefault(); }}><h2>Delete everything for both of you?</h2><p>Both partners’ Love Lab data will be removed. This cannot be undone.</p>{error && <Notice kind="error">{error}</Notice>}<div className="actions"><Button disabled={busy} onClick={() => void remove()}>{busy ? 'Deleting…' : 'Yes, delete everything'}</Button><Button disabled={busy} variant="text" onClick={() => dialog.current?.close()}>Cancel</Button></div></dialog>
  </Page>;
}
