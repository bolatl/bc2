import { useCallback, useEffect, useRef, useState } from 'react';

// Minimal Web Speech API types: TypeScript's DOM lib does not ship them.
interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: { readonly transcript: string };
}
interface SpeechRecognitionEventLike extends Event {
  readonly resultIndex: number;
  readonly results: { readonly length: number; readonly [index: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognitionErrorEventLike extends Event {
  readonly error: string;
}
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

const Recognition = typeof window === 'undefined' ? undefined : window.SpeechRecognition ?? window.webkitSpeechRecognition;

const blocked = 'Microphone access was blocked. Allow it in the browser address bar.';
const errorMessages: Record<string, string> = {
  'not-allowed': blocked,
  'service-not-allowed': blocked,
  'no-speech': 'We didn’t hear anything. Tap the microphone to try again.',
  network: 'Voice input needs an internet connection. Please try again.',
  'audio-capture': 'No microphone was found. Check your device and try again.',
};

/**
 * Browser speech-to-text (English). `onFinal` receives each recognised chunk.
 * `stop()` keeps any pending interim words; `cancel()` discards them.
 */
export function useSpeechToText(onFinal: (text: string) => void) {
  const [isListening, setIsListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const interimRef = useRef('');
  const onFinalRef = useRef(onFinal);
  useEffect(() => { onFinalRef.current = onFinal; });

  const end = useCallback((commitInterim: boolean) => {
    const current = recognition.current;
    recognition.current = null;
    if (current) {
      current.onresult = null; current.onerror = null; current.onend = null;
      try { current.abort(); } catch { /* already stopped */ }
    }
    const pending = interimRef.current;
    interimRef.current = '';
    if (commitInterim && pending) onFinalRef.current(pending);
    setInterim(''); setIsListening(false);
  }, []);

  const stop = useCallback(() => end(true), [end]);
  const cancel = useCallback(() => end(false), [end]);

  const start = useCallback(() => {
    if (recognition.current) return;
    if (!Recognition) { setError('Voice input works in Chrome, Edge or Safari.'); return; }
    setError(null);
    const instance = new Recognition();
    instance.lang = 'en-US';
    instance.continuous = true;
    instance.interimResults = true;
    instance.onresult = event => {
      let finalText = '';
      let interimText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finalText += result[0].transcript;
        else interimText += result[0].transcript;
      }
      if (finalText.trim()) onFinalRef.current(finalText.trim());
      interimRef.current = interimText.trim();
      setInterim(interimRef.current);
    };
    instance.onerror = event => {
      if (event.error === 'aborted') return;
      setError(errorMessages[event.error] ?? 'Voice input stopped. Please try again.');
    };
    // Chrome ends recognition on its own after silence: always return to idle.
    instance.onend = () => { if (recognition.current === instance) end(false); };
    try {
      instance.start();
      recognition.current = instance;
      setIsListening(true);
    } catch {
      setError('Voice input could not start. Please try again.');
    }
  }, [end]);

  useEffect(() => cancel, [cancel]);

  return { isSupported: Boolean(Recognition), isListening, interim, error, start, stop, cancel };
}
