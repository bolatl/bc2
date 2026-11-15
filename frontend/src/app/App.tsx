import { useEffect, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Settings2 } from 'lucide-react';
import { useSession } from './session';
import { Button, Loading, Notice, Page } from '../components/ui';
import { WelcomePage, OnboardingPage, ChoosePage, PersonalityPage, PersonalityResultPage, InvitePage } from '../features/Onboarding';
import { FightPage, ResultPage, PaywallPage, CheckoutSuccessPage, CheckoutCancelPage } from '../features/Conversation';
import { HomePage, JournalPage, RatingPage, StatsPage, SettingsPage } from '../features/Journal';
import { config } from '../config';

function Protected({ children }: { children: ReactNode }) {
  const { couple, loading, checking, error, refresh } = useSession();
  if (loading) return <Loading label="Opening your space…" />;
  const reconnect = <Page title="Let’s reconnect." eyebrow="Connection interrupted"><Notice kind="error">{error}</Notice><Button onClick={() => void refresh().catch(() => undefined)}>Try again</Button></Page>;
  if (!couple) return error ? reconnect : <Navigate to="/" replace />;
  return <>{error ? reconnect : checking ? <Loading label="Checking your session…" /> : null}<div hidden={checking || !!error} inert={checking || !!error}>{children}</div></>;
}
export function App() {
  const { couple } = useSession();
  const location = useLocation();
  const focused = /^\/(fight-sessions|onboarding|personality|invites)/.test(location.pathname);
  useEffect(() => { window.scrollTo(0, 0); }, [location.pathname]);
  return <div className="app-shell">
    <a href="#main" className="skip-link">Skip to content</a>
    <header className="site-header"><Link to={couple ? '/home' : '/'} className="brand" aria-label="Love Lab home"><span className="brand-mark" aria-hidden="true">L</span><span>Love Lab<span className="brand-dot">.</span></span></Link>
      {couple ? <nav aria-label="Main navigation"><NavLink to="/home">Your space</NavLink>{!focused && <NavLink to="/journal">Journal</NavLink>}<NavLink to="/settings" className="settings-link" aria-label="Settings"><Settings2 size={19} /></NavLink></nav> : <span className="header-note">A better way to begin.</span>}
    </header>
    {(config.llmMode === 'mock' || config.paymentMode === 'mock' || config.paymentMode === 'stripe_test') && <div className="mode-note">{[config.llmMode === 'mock' ? 'Demo responses' : null, config.paymentMode === 'mock' ? 'Simulated payment — no charge' : config.paymentMode === 'stripe_test' ? 'Test payment' : null].filter(Boolean).join(' · ')}</div>}
    <main id="main"><Routes>
      <Route path="/" element={<WelcomePage />} />
      <Route path="/onboarding" element={<OnboardingPage />} />
      <Route path="/invites/:token" element={<InvitePage />} />
      <Route path="/choose" element={<Protected><ChoosePage /></Protected>} />
      <Route path="/home" element={<Protected><HomePage /></Protected>} />
      <Route path="/personality" element={<Protected><PersonalityPage /></Protected>} />
      <Route path="/personality/result" element={<Protected><PersonalityResultPage /></Protected>} />
      <Route path="/fight-sessions/:id" element={<Protected><FightPage /></Protected>} />
      <Route path="/fight-sessions/:id/result" element={<Protected><ResultPage /></Protected>} />
      <Route path="/paywall" element={<Protected><PaywallPage /></Protected>} />
      <Route path="/checkout/success" element={<Protected><CheckoutSuccessPage /></Protected>} />
      <Route path="/checkout/cancel" element={<Protected><CheckoutCancelPage /></Protected>} />
      <Route path="/journal" element={<Protected><JournalPage /></Protected>} />
      <Route path="/journal/:recordId/rating" element={<Protected><RatingPage /></Protected>} />
      <Route path="/stats" element={<Protected><StatsPage /></Protected>} />
      <Route path="/settings" element={<Protected><SettingsPage /></Protected>} />
      <Route path="*" element={<Page number="404" title="A different place to start."><p>This page isn’t available.</p><Link className="button button-primary" to={couple ? '/home' : '/'}>Back to Love Lab</Link></Page>} />
    </Routes></main>
    <footer className="site-footer"><span className="footer-brand">A little more understanding.</span><p>Love Lab is an educational tool for couples. Your host is an AI, not a human or a therapist. It doesn’t diagnose and doesn’t replace counseling.</p><span className="footer-end">Love Lab</span></footer>
  </div>;
}
