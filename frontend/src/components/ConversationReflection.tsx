import { useId, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowUpRight, LockKeyhole, Sparkles } from 'lucide-react';
import '../styles/conversation-reflection.css';

export type ConversationReflectionData = {
  summary: string;
  facets: {
    id: string;
    label: string;
    kind: 'strength' | 'growth';
    explanation: string | null;
    practice: string | null;
  }[];
};

const facetColors = ['#F0A04B', '#EFB3C6', '#9ABBD4', '#CAB2D5', '#A8C7B1'];

function segment(index: number, count: number) {
  const gap = 3;
  const start = index * 360 / count - 90 + gap / 2;
  const end = (index + 1) * 360 / count - 90 - gap / 2;
  const point = (radius: number, angle: number) => [120 + radius * Math.cos(angle * Math.PI / 180), 120 + radius * Math.sin(angle * Math.PI / 180)];
  const [x1, y1] = point(104, start);
  const [x2, y2] = point(104, end);
  const [x3, y3] = point(64, end);
  const [x4, y4] = point(64, start);
  return `M ${x1} ${y1} A 104 104 0 ${end - start > 180 ? 1 : 0} 1 ${x2} ${y2} L ${x3} ${y3} A 64 64 0 ${end - start > 180 ? 1 : 0} 0 ${x4} ${y4} Z`;
}

/** Equal sections organize qualitative themes; their size is not a psychological score. */
export function ConversationReflection({ reflection, locked = false, action, feltText, needText, className = '' }: {
  reflection?: ConversationReflectionData | null;
  locked?: boolean;
  action?: ReactNode;
  feltText?: string;
  needText?: string;
  className?: string;
}) {
  const headingId = useId();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const facets = reflection?.facets ?? [];
  const selected = facets.find(facet => facet.id === selectedId) ?? facets[0];
  return <section className={`conversation-reflection ${locked ? 'reflection-is-locked locked-preview-guide' : 'reflection-is-open'} ${className}`} aria-labelledby={headingId}>
    <header className="reflection-header">
      <span className="reflection-symbol"><Sparkles size={23} strokeWidth={1.4} aria-hidden="true" /></span>
      <p className="eyebrow">Your conversation reflection</p>
      <h2 id={headingId}>Understand what you bring to the conversation.</h2>
      <p>{reflection?.summary || 'Find the strengths you can draw on, and the moments where a different approach could help.'}</p>
    </header>
    {facets.length > 0 ? <>
      <div className="reflection-map">
        <div className="reflection-chart-wrap">
          <svg className="reflection-chart" viewBox="0 0 240 240" role="img" aria-label={`Conversation themes: ${facets.map(facet => facet.label).join(', ')}. Equal sections, not scores.`}>
            {facets.map((facet, index) => <path key={facet.id} d={segment(index, facets.length)} fill={facetColors[index % facetColors.length]} opacity={facet.id === selected?.id ? 1 : .72} />)}
          </svg>
          <div className="reflection-chart-center"><span><Sparkles size={22} strokeWidth={1.4} aria-hidden="true" /></span><strong>Your<br />perspective</strong></div>
        </div>
        <div className="reflection-legend" aria-label="Themes in your reflection">
          {facets.map((facet, index) => <button className={`reflection-legend-item ${selected?.id === facet.id ? 'is-selected' : ''}`} type="button" key={facet.id} aria-pressed={selected?.id === facet.id} onClick={() => setSelectedId(facet.id)} style={{ '--facet-color': facetColors[index % facetColors.length] } as CSSProperties}>
            <i aria-hidden="true" /><span><strong>{facet.label}</strong><small>{facet.kind === 'strength' ? 'Strength to draw on' : 'Room to practice'}</small></span><ArrowUpRight size={14} aria-hidden="true" />
          </button>)}
        </div>
      </div>
      <p className="reflection-chart-note">The sections name themes in this conversation, not measured scores or fixed traits.</p>
      {selected && <div className="reflection-detail" aria-live="polite">
        <p className="eyebrow">{selected.kind === 'strength' ? 'A strength to draw on' : 'A place to practice'}</p><h3>{selected.label}</h3>
        <p>{selected.explanation ?? 'No explanation was saved for this theme.'}</p>
        {!locked && selected.practice && <div className="reflection-practice"><strong>Something to try</strong><p>{selected.practice}</p></div>}
      </div>}
      {locked ? <div className="reflection-locked-details">
        <div className="reflection-detail-skeleton" aria-hidden="true" inert>{[0, 1, 2].map(index => <div key={index}><i /><span /><span /></div>)}</div>
        <div className="reflection-unlock"><LockKeyhole size={18} aria-hidden="true" /><h3>Turn these insights into a better conversation.</h3><p>Open practical steps for using your strengths and working through difficult moments. Invite your partner to explore their own perspective too.</p>{action && <div className="reflection-action">{action}</div>}</div>
      </div> : null}
    </> : <div className="reflection-empty">
      {feltText || needText ? <div className="reflection-first-insight">{feltText && <div><h3>What you felt</h3><p>{feltText}</p></div>}{needText && <div><h3>What you needed</h3><p>{needText}</p></div>}</div> : <><div className="reflection-empty-ring" aria-hidden="true"><Sparkles size={27} strokeWidth={1.3} /></div><h3>A reflection grounded in your words.</h3><p>Your conversation themes appear after you share your situation. No personal assessment is available yet.</p></>}
      {locked && <div className="reflection-locked-details reflection-empty-unlock"><div className="reflection-detail-skeleton" aria-hidden="true" inert>{[0, 1].map(index => <div key={index}><i /><span /><span /></div>)}</div><div className="reflection-unlock"><LockKeyhole size={17} aria-hidden="true" /><h3>Make room for a different approach.</h3><p>Continue your preparation to explore your patterns and get practical steps for the conversation.</p>{action && <div className="reflection-action">{action}</div>}</div></div>}
    </div>}
    {locked && <p className="reflection-footer"><LockKeyhole size={13} aria-hidden="true" />Your opening words are next.</p>}
  </section>;
}
