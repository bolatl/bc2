import { useId, type ReactNode } from 'react';
import { LockKeyhole } from 'lucide-react';
import '../styles/locked-preview.css';

type PreviewVariant = 'guide' | 'journal' | 'patterns';

const previewCopy: Record<PreviewVariant, { title: string; description: string }> = {
  guide: {
    title: 'Your conversation has more room to grow.',
    description: 'Continue with a couple’s plan to prepare your opening words and invite your partner.',
  },
  journal: {
    title: 'A place for your conversations.',
    description: 'Your couple’s plan includes shared check-ins and a journal you can return to together.',
  },
  patterns: {
    title: 'See what changes over time.',
    description: 'Your couple’s plan brings your conversation topics and shared check-ins into one view.',
  },
};

/** A visual preview only. Restricted response data must never be passed here. */
export function LockedPreview({ variant = 'guide', title, description, action, compact = false }: {
  variant?: PreviewVariant;
  title?: string;
  description?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  const id = useId();
  const copy = previewCopy[variant];
  return <section className={`locked-preview locked-preview-${variant}${compact ? ' locked-preview-compact' : ''}`} aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}>
    <div className="locked-preview-skeleton" aria-hidden="true" inert>
      {variant === 'guide' ? <>
        <div className="locked-skeleton-note"><i /><i /><i /></div>
        <div className="locked-skeleton-pair"><div><b /><i /><i /></div><div><b /><i /><i /></div></div>
        <div className="locked-skeleton-list">{[0, 1, 2].map(index => <div key={index}><b /><i /></div>)}</div>
      </> : variant === 'journal' ? <>
        <div className="locked-skeleton-pair"><div><b /><i /></div><div><b /><i /></div></div>
        <div className="locked-skeleton-list">{[0, 1, 2, 3].map(index => <div key={index}><b /><span><i /><i /></span><em /></div>)}</div>
      </> : <>
        <div className="locked-skeleton-note"><i /><i /></div>
        <div className="locked-skeleton-chart">{[32, 52, 44, 70, 58, 82, 74].map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}</div>
        <div className="locked-skeleton-pair"><div><i /><i /></div><div><i /><i /></div></div>
      </>}
    </div>
    <div className="locked-preview-content">
      <span className="locked-preview-icon"><LockKeyhole size={21} strokeWidth={1.6} aria-hidden="true" /></span>
      <p className="locked-preview-label">Included with your couple’s plan</p>
      <h2 id={`${id}-title`}>{title ?? copy.title}</h2>
      <p id={`${id}-description`} className="locked-preview-description">{description ?? copy.description}</p>
      {action && <div className="locked-preview-action">{action}</div>}
    </div>
  </section>;
}
