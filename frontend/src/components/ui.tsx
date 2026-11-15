import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { ArrowRight, LockKeyhole } from 'lucide-react';
export { ArrowRight };

export function BrandMark({ size = 40, className = '' }: { size?: number; className?: string }) {
  const clipId = useId();
  return <svg className={className} width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true"><defs><clipPath id={clipId}><circle cx="24" cy="28" r="18" /></clipPath></defs><path d="m13 40-5 15 16-11Z" fill="var(--you)" /><path d="m51 40 5 15-16-11Z" fill="var(--partner)" /><circle cx="24" cy="28" r="18" fill="var(--you)" /><circle cx="40" cy="28" r="18" fill="var(--partner)" /><circle cx="40" cy="28" r="18" fill="var(--ink)" clipPath={`url(#${clipId})`} /></svg>;
}

export function Button({ variant = 'primary', className = '', type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'text' }) {
  return <button type={type} className={`button button-${variant} ${className}`} {...props} />;
}
export function Page({ eyebrow, title, description, number, children, className = '', layout = 'form', aside }: { eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; number?: ReactNode; children?: ReactNode; className?: string; layout?: 'wide' | 'form'; aside?: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [title]);
  return <section className={`page-grid page-${layout} ${className}`}>
    {layout === 'form' && <aside className="page-aside"><div className="page-context">{eyebrow && <div className="eyebrow">{eyebrow}</div>}{number !== undefined && <div className={`page-number ${typeof number === 'string' && number.length > 3 ? 'page-label' : ''}`}>{number}</div>}{aside || <div className="context-privacy"><LockKeyhole size={18} aria-hidden="true" /><p>A little room for your perspective.<span>Your answers stay private from your partner.</span></p></div>}</div></aside>}
    <div className="page-content"><header className="page-heading">{layout === 'wide' && eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1 tabIndex={-1} ref={heading}>{title}</h1>{description && <div className="lead">{description}</div>}</header>{children}</div>
  </section>;
}
export function Notice({ children, kind = 'info' }: { children: ReactNode; kind?: string }) {
  return <div className={`notice notice-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div>;
}
export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <div className="loading" role="status"><span className="loading-mark" aria-hidden="true"><i /><i /></span><span>{label}</span></div>;
}
export function Scale({ value, onChange, disabled = false, tone = 'intensity' }: { value: number | null; onChange: (value: number) => void; disabled?: boolean; tone?: 'intensity' | 'rating' }) {
  const name = useId();
  return <fieldset className={`scale-field scale-${tone}`} disabled={disabled}><legend className="sr-only">Choose a number from 1 to 10</legend><div className="scale">{Array.from({ length: 10 }, (_, i) => i + 1).map(n => {
    const band = tone === 'rating' ? n >= 8 ? 'good' : n >= 5 ? 'mid' : 'bad' : n <= 3 ? 'good' : n <= 6 ? 'mid' : 'bad';
    return <label key={n} className={`scale-option scale-${band} ${value === n ? 'selected' : ''}`}><input type="radio" name={name} value={n} checked={value === n} onChange={() => onChange(n)} /><span>{n}</span></label>;
  })}</div></fieldset>;
}
