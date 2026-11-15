import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, cancelPrivateRequests, errorMessage } from '../api/client';
import type { Couple } from '../api/types';

type Session = { couple: Couple | null; loading: boolean; checking: boolean; error: string | null; refresh: () => Promise<Couple | null>; forget: () => void };
const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const cache = useQueryClient();
  const [couple, setCouple] = useState<Couple | null>(null);
  const identity = useRef<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);
  const inflight = useRef<Promise<Couple | null> | null>(null);
  const refreshVersion = useRef(0);
  const forget = useCallback(() => {
    refreshVersion.current += 1;
    inflight.current = null;
    cancelPrivateRequests();
    cache.clear();
    identity.current = null;
    setCouple(null);
    setLoading(false);
    setChecking(false);
    setEpoch(value => value + 1);
    try { for (const key of Object.keys(sessionStorage)) if (key.startsWith('lovelab.')) sessionStorage.removeItem(key); } catch { /* Storage may be disabled. */ }
  }, [cache]);

  const refresh = useCallback(() => {
    if (inflight.current) return inflight.current;
    let version = ++refreshVersion.current;
    const request = api<Couple>('/couples/me', undefined, { silentAuth: true }).then(data => {
      if (version !== refreshVersion.current) return null;
      const next = `${data.coupleId}:${data.partnerRole}`;
      if (identity.current && identity.current !== next) { forget(); version = refreshVersion.current; }
      identity.current = next;
      setCouple(data);
      setError(null);
      return data;
    }).catch((reason: unknown) => {
      if (version !== refreshVersion.current) return null;
      if (reason instanceof DOMException && reason.name === 'AbortError') return null;
      if (reason instanceof ApiError && reason.status === 401) {
        if (identity.current) forget();
        setCouple(null);
        setError(null);
        return null;
      }
      setError(errorMessage(reason));
      throw reason;
    }).finally(() => {
      if (version === refreshVersion.current) { setLoading(false); setChecking(false); }
      if (inflight.current === request) inflight.current = null;
    });
    inflight.current = request;
    return request;
  }, [forget]);

  useEffect(() => {
    void refresh().catch(() => undefined);
    const unauthorized = () => { forget(); setError(null); setLoading(false); };
    const revalidate = () => {
      setChecking(true);
      if (document.visibilityState !== 'visible') return;
      void refresh().catch(() => undefined);
    };
    window.addEventListener('lovelab:unauthorized', unauthorized);
    document.addEventListener('visibilitychange', revalidate);
    window.addEventListener('pageshow', revalidate);
    return () => {
      window.removeEventListener('lovelab:unauthorized', unauthorized);
      document.removeEventListener('visibilitychange', revalidate);
      window.removeEventListener('pageshow', revalidate);
    };
  }, [refresh, forget]);

  return <SessionContext.Provider value={{ couple, loading, checking, error, refresh, forget }}><div key={epoch}>{children}</div></SessionContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error('SessionProvider is required');
  return context;
}
