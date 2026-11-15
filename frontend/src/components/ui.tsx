import { useEffect, useId, useLayoutEffect, useRef, type ButtonHTMLAttributes, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { ArrowRight, LockKeyhole } from 'lucide-react';
export { ArrowRight };

export function BrandMark({ size = 40, className = '' }: { size?: number; className?: string }) {
  const clipId = useId();
  return <svg className={className} width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true"><defs><clipPath id={clipId}><circle cx="24" cy="28" r="18" /></clipPath></defs><path d="m13 40-5 15 16-11Z" fill="var(--you)" /><path d="m51 40 5 15-16-11Z" fill="var(--partner)" /><circle cx="24" cy="28" r="18" fill="var(--you)" /><circle cx="40" cy="28" r="18" fill="var(--partner)" /><circle cx="40" cy="28" r="18" fill="var(--ink)" clipPath={`url(#${clipId})`} /></svg>;
}

export function Button({ variant = 'primary', className = '', type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'text' }) {
  return <button type={type} className={`button button-${variant} ${className}`} {...props} />;
}
export function Page({ eyebrow, title, description, number, children, className = '', layout = 'form', aside, transitionKey, motionRef }: { eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; number?: ReactNode; children?: ReactNode; className?: string; layout?: 'wide' | 'form'; aside?: ReactNode; transitionKey?: string; motionRef?: RefObject<HTMLDivElement | null> }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const previousStep = useRef(transitionKey);
  useLayoutEffect(() => {
    const changed = previousStep.current !== transitionKey;
    previousStep.current = transitionKey;
    if (!changed || transitionKey === undefined || !content.current) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const headingTop = heading.current?.getBoundingClientRect().top;
    if (headingTop !== undefined && (headingTop < 0 || headingTop > window.innerHeight - 120)) {
      heading.current?.scrollIntoView({ block: 'start', behavior: reducedMotion ? 'instant' : 'smooth' });
    }
    if (reducedMotion || motionRef) return;
    const animation = content.current.animate([
      { opacity: .35, transform: 'translate3d(0, 12px, 0)' },
      { opacity: 1, transform: 'translate3d(0, 0, 0)' },
    ], { duration: 450, easing: 'cubic-bezier(.22,.68,0,1)' });
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const stop = () => { if (preference.matches) animation.cancel(); };
    preference.addEventListener('change', stop);
    return () => { animation.cancel(); preference.removeEventListener('change', stop); };
  }, [transitionKey, motionRef]);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [title]);
  return <section className={`page-grid page-${layout} ${className}`}>
    {layout === 'form' && <aside className="page-aside"><div className="page-context">{eyebrow && <div className="eyebrow">{eyebrow}</div>}{number !== undefined && <div className={`page-number ${typeof number === 'string' && number.length > 3 ? 'page-label' : ''}`}>{number}</div>}{aside || <div className="context-privacy"><LockKeyhole size={18} aria-hidden="true" /><p>A little room for your perspective.<span>Your answers stay private from your partner.</span></p></div>}</div></aside>}
    <div className="page-content" ref={element => { content.current = element; if (motionRef) motionRef.current = element; }} data-transition-key={transitionKey}><header className="page-heading">{layout === 'wide' && eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1 tabIndex={-1} ref={heading}>{title}</h1>{description && <div className="lead">{description}</div>}</header>{children}</div>
  </section>;
}
export function Notice({ children, kind = 'info' }: { children: ReactNode; kind?: string }) {
  return <div className={`notice notice-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div>;
}
export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <div className="loading" role="status"><span className="loading-mark" aria-hidden="true"><i /><i /></span><span>{label}</span></div>;
}
export function Scale({ value, onChange, disabled = false, tone = 'intensity' }: { value: number | null; onChange: (value: number) => void; disabled?: boolean; tone?: 'intensity' | 'rating' }) {
  const id = useId();
  const selected = value ?? 6;
  return <div className={`range-scale range-${tone}`}>
    {tone === 'rating' && <output className="range-rating-value" htmlFor={id}>{value ?? '—'}</output>}
    <input id={id} type="range" min={1} max={10} step={1} value={selected} disabled={disabled}
      aria-label={tone === 'rating' ? 'Conversation rating, 1 to 10' : 'Upset level, 1 to 10'}
      style={{ '--range-fill': `${(selected - 1) / 9 * 100}%` } as CSSProperties}
      onChange={event => onChange(Number(event.target.value))} />
  </div>;
}
