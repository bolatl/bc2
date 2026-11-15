import { useEffect, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ArrowUpRight, BookOpen, ChartNoAxesCombined, HeartHandshake, LockKeyhole, Settings2, UsersRound } from 'lucide-react';
import { useSession } from './session';
import { BrandMark, Button, Loading, Notice, Page } from '../components/ui';
import { SakuraBackdrop } from '../components/SakuraBackdrop';
import { WelcomePage, OnboardingPage, ChoosePage, PersonalityPage, PersonalityResultPage, InvitePage } from '../features/Onboarding';
import { FightPage, ResultPage, PaywallPage, CheckoutSuccessPage, CheckoutCancelPage } from '../features/Conversation';
import { HomePage, PartnerPage, ProfilePage, JournalPage, JournalEntryPage, RatingPage, StatsPage, SettingsPage } from '../features/Journal';
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
  useEffect(() => { window.scrollTo(0, 0); }, [location.pathname]);
  return <div className={`app-shell ${couple ? 'app-authenticated' : 'app-public'}`} data-partner={couple?.partnerRole || 'A'}>
    <SakuraBackdrop />
    <a href="#main" className="skip-link">Skip to content</a>
    <header className="site-header"><Link to={couple ? '/home' : '/'} className="brand" aria-label="Love Lab home"><BrandMark size={40} /><span>love lab</span></Link>
      {couple ? <><nav className="app-nav" aria-label="Main navigation"><NavLink to="/home"><HeartHandshake size={17} aria-hidden="true" />Your space</NavLink><NavLink to="/partner"><UsersRound size={17} aria-hidden="true" />Partner</NavLink><NavLink to="/journal"><BookOpen size={17} aria-hidden="true" />Journal</NavLink><NavLink to="/stats"><ChartNoAxesCombined size={17} aria-hidden="true" />Patterns</NavLink></nav><div className="header-account"><NavLink to="/profile" className="profile-link" aria-label="My profile"><span className="account-avatar">{couple.partnerRole}</span><span>My profile</span></NavLink><NavLink to="/settings" className="settings-link" aria-label="Settings"><Settings2 size={18} aria-hidden="true" /></NavLink></div></> : <><nav className="public-nav" aria-label="Main navigation"><a href="/#how-it-works">How it works</a><a href="/#questions">Questions</a></nav><Link className="header-cta" to="/onboarding">Start a conversation<ArrowUpRight size={16} aria-hidden="true" /></Link></>}
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
      <Route path="/paywall" element={<Protected><PaywallPage /></Protected>} />
      <Route path="/checkout/success" element={<Protected><CheckoutSuccessPage /></Protected>} />
      <Route path="/checkout/cancel" element={<Protected><CheckoutCancelPage /></Protected>} />
      <Route path="/journal" element={<Protected><JournalPage /></Protected>} />
      <Route path="/journal/:recordId" element={<Protected><JournalEntryPage /></Protected>} />
      <Route path="/journal/:recordId/rating" element={<Protected><RatingPage /></Protected>} />
      <Route path="/stats" element={<Protected><StatsPage /></Protected>} />
      <Route path="/settings" element={<Protected><SettingsPage /></Protected>} />
      <Route path="*" element={<Page number="404" title="A different place to start."><p>This page isn’t available.</p><Link className="button button-primary" to={couple ? '/home' : '/'}>Back to Love Lab</Link></Page>} />
    </Routes></main>
    <footer className="site-footer"><div className="footer-brand"><BrandMark size={27} /><span>love lab</span></div><p>Love Lab is an educational tool for couples. Your host is an AI, not a human or a therapist. It doesn’t diagnose and doesn’t replace counseling.</p><span className="footer-end"><LockKeyhole size={14} aria-hidden="true" />Your words, your space.</span></footer>
  </div>;
}
