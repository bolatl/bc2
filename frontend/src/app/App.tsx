import { useEffect, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ArrowUpRight, BookOpen, HeartHandshake, LockKeyhole, Settings2, UsersRound } from 'lucide-react';
import { useSession } from './session';
import { BrandMark, Button, Loading, Notice, Page } from '../components/ui';
import { SakuraBackdrop } from '../components/SakuraBackdrop';
import { WelcomePage, OnboardingPage, ChoosePage, PersonalityPage, PersonalityResultPage, InvitePage } from '../features/Onboarding';
import { FightPage, ResultPage, InsightPage, RehearsalPreviewPage, PaywallPage, CheckoutSuccessPage, CheckoutCancelPage } from '../features/Conversation';
import { DemoCheckoutPage } from '../features/DemoCheckout';
import { PartnerPage, JournalPage, JournalEntryPage, RatingPage, SettingsPage } from '../features/Journal';
import { HomePage, ProfilePage } from '../features/PersonalSpace';
import { config } from '../config';
import '../styles/botanical.css';

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
  const paymentNote = config.paymentMode === 'disabled' ? 'Full demo access — no payment needed'
    : config.paymentMode === 'mock' ? 'Simulated payment — no charge'
    : config.paymentMode === 'stripe_test' ? 'Test payment' : null;
  const modeNote = [config.llmMode === 'mock' ? 'Demo responses' : null, paymentNote].filter(Boolean).join(' · ');
  useEffect(() => {
    const target = location.hash === '#patterns' ? document.getElementById('patterns') : null;
    if (target) target.scrollIntoView();
    else window.scrollTo(0, 0);
  }, [location.pathname, location.hash]);
  return <div className={`app-shell ${couple ? 'app-authenticated' : 'app-public'}`} data-partner={couple?.partnerRole || 'A'}>
    <SakuraBackdrop />
    <a href="#main" className="skip-link">Skip to content</a>
    <header className="site-header"><Link to={couple ? '/home' : '/'} className="brand" aria-label="Kintsugi home"><BrandMark size={40} /><span>Kintsugi</span></Link>
      {couple ? <><nav className="app-nav" aria-label="Main navigation"><NavLink to="/home"><HeartHandshake size={17} aria-hidden="true" />My space</NavLink><NavLink to="/journal"><BookOpen size={17} aria-hidden="true" />Journal</NavLink><NavLink to="/partner"><UsersRound size={17} aria-hidden="true" />Partner</NavLink></nav><div className="header-account"><NavLink to="/profile" className="profile-link" aria-label="My profile"><span className="account-avatar">{couple.partnerRole}</span><span>My profile</span></NavLink><NavLink to="/settings" className="settings-link" aria-label="Settings"><Settings2 size={18} aria-hidden="true" /></NavLink></div></> : <><nav className="public-nav" aria-label="Main navigation"><a href="/#how-it-works">How it works</a><a href="/#questions">Questions</a></nav><Link className="header-cta" to="/onboarding">Start a conversation<ArrowUpRight size={16} aria-hidden="true" /></Link></>}
    </header>
    {modeNote && <div className="mode-note">{modeNote}</div>}
    <main id="main"><Routes>
      <Route path="/" element={<WelcomePage />} />
      <Route path="/onboarding" element={<OnboardingPage />} />
      <Route path="/invites/:token" element={<InvitePage />} />
      <Route path="/choose" element={<Protected><ChoosePage /></Protected>} />
      <Route path="/home" element={<Protected><HomePage /></Protected>} />
      <Route path="/partner" element={<Protected><PartnerPage /></Protected>} />
      <Route path="/profile" element={<Protected><ProfilePage /></Protected>} />
      <Route path="/personality" element={<Protected><PersonalityPage /></Protected>} />
      <Route path="/personality/result" element={<Protected><PersonalityResultPage /></Protected>} />
      <Route path="/fight-sessions/:id" element={<Protected><FightPage /></Protected>} />
      <Route path="/fight-sessions/:id/result" element={<Protected><ResultPage /></Protected>} />
      <Route path="/fight-sessions/:id/insight" element={<Protected><InsightPage /></Protected>} />
      <Route path="/fight-sessions/:id/rehearsal" element={<Protected><RehearsalPreviewPage /></Protected>} />
      <Route path="/paywall" element={<Protected><PaywallPage /></Protected>} />
      <Route path="/checkout/demo" element={<Protected><DemoCheckoutPage /></Protected>} />
      <Route path="/checkout/success" element={<Protected><CheckoutSuccessPage /></Protected>} />
      <Route path="/checkout/cancel" element={<Protected><CheckoutCancelPage /></Protected>} />
      <Route path="/journal" element={<Protected><JournalPage /></Protected>} />
      <Route path="/journal/:recordId" element={<Protected><JournalEntryPage /></Protected>} />
      <Route path="/journal/:recordId/rating" element={<Protected><RatingPage /></Protected>} />
      <Route path="/stats" element={<Protected><Navigate to="/home" replace /></Protected>} />
      <Route path="/settings" element={<Protected><SettingsPage /></Protected>} />
      <Route path="*" element={<Page number="404" title="A different place to start."><p>This page isn’t available.</p><Link className="button button-primary" to={couple ? '/home' : '/'}>Back to Kintsugi</Link></Page>} />
    </Routes></main>
    <footer className="site-footer"><div className="footer-brand"><BrandMark size={27} /><span>Kintsugi</span></div><span className="footer-end"><LockKeyhole size={14} aria-hidden="true" />Your words, your space.</span></footer>
  </div>;
}
