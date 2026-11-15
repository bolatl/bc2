import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { ArrowRight, LoaderCircle } from 'lucide-react';
export { ArrowRight };

export function Button({ variant = 'primary', className = '', type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'text' }) {
  return <button type={type} className={`button button-${variant} ${className}`} {...props} />;
}
export function Page({ eyebrow, title, description, number, children, className = '' }: { eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; number?: ReactNode; children?: ReactNode; className?: string }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [title]);
  return <section className={`page-grid ${className}`}>
    <aside className="page-aside">{eyebrow && <div className="eyebrow">{eyebrow}</div>}{number !== undefined && <div className={`page-number ${typeof number === 'string' && number.length > 3 ? 'page-label' : ''}`}>{number}</div>}</aside>
    <div className="page-content"><h1 tabIndex={-1} ref={heading}>{title}</h1>{description && <div className="lead">{description}</div>}{children}</div>
  </section>;
}
export function Notice({ children, kind = 'info' }: { children: ReactNode; kind?: string }) {
  return <div className={`notice notice-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div>;
}
export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <div className="loading" role="status"><LoaderCircle size={20} aria-hidden="true" className="spinner" />{label}</div>;
}
export function Scale({ value, onChange, disabled = false }: { value: number | null; onChange: (value: number) => void; disabled?: boolean }) {
  return <fieldset className="scale-field" disabled={disabled}><legend className="sr-only">Choose a number from 1 to 10</legend><div className="scale">{Array.from({ length: 10 }, (_, i) => i + 1).map(n => <label key={n} className={`scale-option ${value === n ? 'selected' : ''}`}><input type="radio" name="scale" value={n} checked={value === n} onChange={() => onChange(n)} /><span>{n}</span></label>)}</div></fieldset>;
}
