import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ArrowUpRight, BookOpen, Check, HeartHandshake, Lightbulb, LockKeyhole, ShieldCheck, Sparkles, TrendingUp, UserRound, UsersRound } from 'lucide-react';
import { api, ApiError, errorMessage } from '../api/client';
import type { Personality, Stats, Subscription } from '../api/types';
import { useSession } from '../app/session';
import { Button, Loading, Notice, Page } from '../components/ui';
import '../styles/journal.css';
import '../styles/personal-space.css';

function date(value: string) {
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const topics: Record<string, string> = {
  money: 'Money', chores: 'Sharing the chores', kids: 'Parenting', family: 'Family', phone: 'Phone time', jealousy: 'Jealousy', closeness: 'Feeling close', plans_decisions: 'Plans and decisions', time_attention: 'Time and attention', other: 'Something else',
};

function QueryFailure({ error, retry }: { error: unknown; retry: () => void }) {
  return <Notice kind="error">{errorMessage(error)} <Button variant="text" onClick={retry}>Try again</Button></Notice>;
}

export function HomePage() {
  const { couple } = useSession();
  const personalityDone = Boolean(couple?.personalityDone);
  const personality = useQuery({
    queryKey: ['personality', couple?.coupleId, couple?.partnerRole],
    queryFn: ({ signal }) => api<Personality>('/personality-tests/me', undefined, { signal }),
    enabled: Boolean(couple && personalityDone), retry: false,
  });
  return <Page className="dashboard-page personal-space-page my-space-page" layout="wide" eyebrow="Your personal space" title="My space" description="Your conversations, a clearer picture of yourself, and small things to try.">
    <div className="space-overview-links">
      <Link className="space-journal-link dashboard-card" to="/journal"><span className="feature-icon"><BookOpen size={26} aria-hidden="true" /></span><span><strong>Your conversations</strong><span>Continue a conversation, revisit an earlier one, or start something new.</span></span><ArrowUpRight size={22} aria-hidden="true" /></Link>
      <div className="space-secondary-links">
        <Link className="dashboard-link" to="/partner"><UsersRound size={22} aria-hidden="true" /><span><strong>Your partner</strong><span>See their preparation status.</span></span><ArrowUpRight size={18} aria-hidden="true" /></Link>
        <Link className="dashboard-link" to="/profile"><UserRound size={22} aria-hidden="true" /><span><strong>My profile</strong><span>Your information, preferences, and shared plan.</span></span><ArrowUpRight size={18} aria-hidden="true" /></Link>
      </div>
    </div>

    <section className="space-patterns" id="patterns" aria-labelledby="space-patterns-heading">
      <div className="space-section-heading"><div><p className="eyebrow">From your About me test</p><h2 id="space-patterns-heading">Your patterns</h2></div><span className="space-private-note"><LockKeyhole size={14} aria-hidden="true" />Only you see your personal results</span></div>
      {!personalityDone ? <div className="space-about-prompt dashboard-card"><span className="feature-icon feature-icon-partner"><Sparkles size={28} aria-hidden="true" /></span><div><h3>Get to know your patterns</h3><p>Answer 20 short questions about yourself. Your strengths and suggestions will appear here when you finish.</p><Link className="button button-primary" to="/personality">Take the About me test<ArrowRight size={18} aria-hidden="true" /></Link></div></div>
        : personality.isPending ? <Loading label="Opening your personal patterns…" />
          : personality.error ? <QueryFailure error={personality.error} retry={() => void personality.refetch()} />
            : personality.data && <>
              <div className="space-personal-patterns">
                <section className="dashboard-card space-strengths"><div className="personal-card-heading"><Sparkles size={22} aria-hidden="true" /><h3>What you bring</h3></div><ul>{personality.data.strengths.map(text => <li key={text}><Check size={18} aria-hidden="true" /><span>{text}</span></li>)}</ul></section>
                <section className="dashboard-card space-suggestions"><div className="personal-card-heading"><Lightbulb size={22} aria-hidden="true" /><h3>Something to try</h3></div><ol>{personality.data.tips.map(text => <li key={text}>{text}</li>)}</ol></section>
              </div>
              <div className="space-patterns-footer"><p>Based on your answers from {date(personality.data.completedAt)}.</p><Link className="text-link" to="/personality/result">View your full reflection<ArrowUpRight size={16} aria-hidden="true" /></Link></div>
            </>}
      {personalityDone && <ConversationPatterns />}
    </section>
  </Page>;
}

function ConversationPatterns() {
  const { couple } = useSession();
  const query = useQuery({
    queryKey: ['stats', couple?.coupleId, couple?.partnerRole],
    queryFn: ({ signal }) => api<Stats>('/journal/stats', undefined, { signal }),
    enabled: Boolean(couple?.personalityDone), retry: false,
  });
  const data = query.data;
  return <section className="space-conversation-patterns" aria-labelledby="conversation-patterns-heading">
    <div className="space-section-heading"><div><p className="eyebrow">From your shared journal</p><h3 id="conversation-patterns-heading">Your conversations over time</h3></div></div>
    {query.isPending ? <Loading label="Opening your shared patterns…" />
      : query.error instanceof ApiError && query.error.status === 402 ? <div className="dashboard-card space-patterns-empty"><p>Shared trends become available with your couple’s plan. You can still find your current conversation in the journal.</p><Link className="text-link" to="/journal">Open journal<ArrowRight size={16} aria-hidden="true" /></Link></div>
        : query.error ? <QueryFailure error={query.error} retry={() => void query.refetch()} />
          : data && data.totalFights === 0 ? <div className="dashboard-card space-patterns-empty"><TrendingUp size={26} aria-hidden="true" /><h4>Your shared history starts with a conversation.</h4><p>As you prepare and check in together, your topics and shared ratings will appear here.</p><Link className="text-link" to="/journal">Open journal<ArrowRight size={16} aria-hidden="true" /></Link></div>
            : data && <div className="space-history-grid">
              <section className="dashboard-card space-history-summary"><span className="eyebrow">Shared journal entries</span><strong>{data.totalFights}</strong>{data.recurringTopicHint ? <><h4>{topics[data.recurringTopicHint] ?? data.recurringTopicHint}</h4><p>This topic has come up in at least three conversations.</p></> : <p>Your conversations help build a picture over time.</p>}<Link className="text-link" to="/journal">View conversations<ArrowRight size={16} aria-hidden="true" /></Link></section>
              <section className="dashboard-card space-rating-trend"><h4>How your conversations felt</h4><p>Average of both partners’ check-ins, in conversation order.</p>{data.averageRatingTrend.length ? <><RatingTrend ratings={data.averageRatingTrend} /><p className="chart-caption">Shared ratings: {data.averageRatingTrend.join(' · ')} / 10</p></> : <div className="space-ratings-empty">Add a numeric check-in after you have both prepared to start your shared trend.</div>}</section>
              <section className="dashboard-card space-topic-patterns"><h4>Topics in your journal</h4><div>{Object.entries(data.topicCounts).sort((a, b) => b[1] - a[1]).map(([topic, count]) => <div className="space-topic-count" key={topic}><span>{topics[topic] ?? topic}</span><span>{count} {count === 1 ? 'conversation' : 'conversations'}</span></div>)}</div></section>
            </div>}
  </section>;
}

function RatingTrend({ ratings }: { ratings: number[] }) {
  const x = (index: number) => ratings.length === 1 ? 316 : 40 + index / (ratings.length - 1) * 550;
  const y = (value: number) => 178 - (value - 1) / 9 * 155;
  return <svg className="trend-chart" viewBox="0 0 620 205" role="img" aria-label={`Average ratings in order: ${ratings.join(', ')}`}>
    {[1, 5, 8, 10].map(value => <g key={value}><line x1="40" x2="590" y1={y(value)} y2={y(value)} className="chart-gridline" /><text x="16" y={y(value) + 4} className="chart-label">{value}</text></g>)}
    <polyline points={ratings.map((value, index) => `${x(index)},${y(value)}`).join(' ')} fill="none" className="chart-line" strokeWidth="2.5" strokeLinejoin="round" />
    {ratings.map((value, index) => <circle key={index} cx={x(index)} cy={y(value)} r="5.5" className={`chart-point ${value >= 8 ? 'green' : value >= 5 ? 'yellow' : 'red'}`}><title>Shared rating {index + 1}: {value} out of 10</title></circle>)}
  </svg>;
}

const relationships: Record<string, string> = { dating: 'Dating', living_together: 'Living together', engaged: 'Engaged', married: 'Married' };
const conflictStyles: Record<string, string> = { get_loud: 'I tend to raise my voice', shut_down: 'I tend to go quiet', talk_now: 'I try to resolve things right away', need_space: 'I need some space first' };
const repairNeeds: Record<string, string> = { alone_time: 'Some time to myself', being_heard: 'Being heard and talking it through', closeness: 'Closeness and reassurance', apology: 'An apology', plan: 'A clear plan for next time' };
const goals: Record<string, string> = { fewer_fights: 'Fewer arguments', understand_each_other: 'Understanding each other', prepare_marriage: 'Preparing for marriage', feel_close: 'Feeling closer' };
const togetherDurations: Record<string, string> = { '<1': 'Less than a year', '1-3': '1–3 years', '3-7': '3–7 years', '7+': 'More than 7 years' };
const children: Record<string, string> = { no: 'No', expecting: 'Expecting', yes: 'Yes' };

export function ProfilePage() {
  const { couple, refresh } = useSession();
  const own = couple?.ownProfile;
  const plan = useQuery({
    queryKey: ['profile-subscription', couple?.coupleId, couple?.partnerRole],
    queryFn: ({ signal }) => api<Subscription>('/subscriptions/me', undefined, { signal }),
    enabled: Boolean(couple), retry: false,
  });
  const planTitles = { monthly: 'Monthly plan', yearly: 'Yearly plan', program: 'Couples program' };
  const info = [
    ['Relationship', own?.relationshipStatus && (relationships[own.relationshipStatus] ?? own.relationshipStatus)],
    ['My partner', own?.partnerName],
    ['In a disagreement', own?.conflictStyle && (conflictStyles[own.conflictStyle] ?? own.conflictStyle)],
    ['What helps afterward', own?.repairNeed && (repairNeeds[own.repairNeed] ?? own.repairNeed)],
    ['Age range', own?.age && (own.age === 'other' ? 'Another age range' : own.age.replaceAll('-', '–'))],
    ['Together', own?.togetherDuration && (togetherDurations[own.togetherDuration] ?? own.togetherDuration)],
    ['Children', own?.hasKids && (children[own.hasKids] ?? own.hasKids)],
    ['What I’m working toward', own?.goal && (goals[own.goal] ?? own.goal)],
    ['Topics on my mind', own?.fightTopics?.map(topic => topics[topic] ?? topic).join(', ')],
  ].filter(([, value]) => Boolean(value));
  const planStatus = plan.data?.status;
  return <Page className="profile-page personal-space-page my-profile-page" layout="wide" eyebrow="Your personal information" title="My profile" description="What you shared about yourself, your test, and your access.">
    <div className="profile-workspace">
      <aside className="profile-identity-card dashboard-card"><span className="profile-avatar"><UserRound size={34} aria-hidden="true" /></span><h2>You</h2><span className="profile-role">Partner {couple?.partnerRole}</span><p>Your personal information stays private from your partner.</p><dl><div><dt>Shared space created</dt><dd>{couple ? date(couple.createdAt) : '—'}</dd></div><div><dt>About me test</dt><dd>{couple?.personalityDone ? 'Completed' : 'Not started'}</dd></div></dl><Link className="text-link" to="/journal">Your conversations<ArrowUpRight size={16} aria-hidden="true" /></Link></aside>
      <div className="profile-sections">
        <section className="dashboard-card profile-about-card"><div className="personal-card-heading"><UserRound size={22} aria-hidden="true" /><h2>About you</h2></div><p>From the information you provided when you joined.</p>{own ? <dl className="profile-saved-details">{info.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl> : <><p>Your saved information isn’t available yet.</p><Button variant="secondary" onClick={() => void refresh().catch(() => undefined)}>Reload profile</Button></>}</section>
        <section className="dashboard-card profile-test-card"><div><Sparkles size={23} aria-hidden="true" /><h2>About me test</h2></div><p>{couple?.personalityDone ? 'Your personal patterns and suggestions are ready in My space.' : 'Take 20 short questions to see your personal patterns and suggestions in My space.'}</p><Link className="button button-secondary" to={couple?.personalityDone ? '/home#patterns' : '/personality'}>{couple?.personalityDone ? 'View my patterns' : 'Take the About me test'}<ArrowRight size={17} aria-hidden="true" /></Link></section>
        <div className="profile-details-grid">
          <section className="profile-plan-card dashboard-card"><span className="feature-icon feature-icon-partner"><HeartHandshake size={23} aria-hidden="true" /></span><h2>Your shared plan</h2>{plan.isPending ? <Loading label="Checking your plan…" /> : plan.error ? <QueryFailure error={plan.error} retry={() => void plan.refetch()} /> : <><p className="profile-plan-status">{planStatus === 'active' ? 'Full access is active' : planStatus === 'pending' ? 'Checkout is waiting' : 'No active plan'}</p><p>{planStatus === 'active' ? `${plan.data?.activatedAt ? `${planTitles[plan.data.plan]}. ` : ''}Your access applies to every conversation for both partners. You don’t need to pay again to start another.` : planStatus === 'pending' ? 'Your existing checkout is ready to continue.' : 'One plan covers both partners and your future conversations.'}</p>{planStatus !== 'active' && (couple?.partnerRole === 'A' ? <Link className="text-link" to="/paywall">{planStatus === 'pending' ? 'Resume checkout' : 'View plans'}<ArrowUpRight size={16} aria-hidden="true" /></Link> : <p className="quiet">Your partner manages your couple’s plan.</p>)}</>}</section>
          <section className="profile-settings-card dashboard-card"><span className="feature-icon feature-icon-soft"><ShieldCheck size={23} aria-hidden="true" /></span><h2>Privacy &amp; your data</h2><p>Your answers, personal patterns, and preparation stay private. Your partner can see your conversation status and shared check-ins.</p><Link className="text-link" to="/settings">Manage your data<ArrowUpRight size={16} aria-hidden="true" /></Link></section>
        </div>
      </div>
    </div>
  </Page>;
}
