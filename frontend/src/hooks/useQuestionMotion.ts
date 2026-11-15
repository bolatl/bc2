import { useEffect, useLayoutEffect, useRef } from 'react';

type Direction = 'forward' | 'backward';

// Animate the live card only after the next server step is available. No copies
// of private answers are retained, and a failed request leaves the card in place.
export function useQuestionMotion(step: string | undefined) {
  const contentRef = useRef<HTMLDivElement>(null);
  const previousStep = useRef(step);
  const direction = useRef<Direction>('forward');
  const running = useRef<Animation[]>([]);

  function cancel() {
    running.current.forEach(animation => animation.cancel());
    running.current = [];
    if (contentRef.current) contentRef.current.dataset.swipePhase = 'idle';
  }

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => { if (preference.matches) cancel(); };
    preference.addEventListener('change', onChange);
    return () => { cancel(); preference.removeEventListener('change', onChange); };
  }, []);

  useLayoutEffect(() => {
    const previous = previousStep.current;
    previousStep.current = step;
    cancel();
    const element = contentRef.current;
    if (!element || !previous || !step || previous === step || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const sign = direction.current === 'forward' ? 1 : -1;
    element.dataset.swipeDirection = direction.current;
    element.dataset.swipePhase = 'entering';
    const animations = [element.animate([
      { opacity: 0, transform: `translate3d(${sign * 85}px, 0, 0) rotate(${sign * .6}deg) scale(.985)` },
      { opacity: 1, transform: 'translate3d(0, 0, 0) rotate(0deg) scale(1)' },
    ], { duration: 340, easing: 'cubic-bezier(.16,1,.3,1)' })];
    // The answers follow the question a beat later, like cards in a small deck.
    element.querySelectorAll('.answer-card, .rehearsal-option, .intensity-display, .checkpoint-summary, .story-examples button').forEach((card, index) => {
      animations.push(card.animate([
        { opacity: 0, transform: `translate3d(${sign * 28}px, 8px, 0) scale(.98)` },
        { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)' },
      ], { duration: 290, delay: 55 + index * 45, fill: 'backwards', easing: 'cubic-bezier(.16,1,.3,1)' }));
    });
    running.current = animations;
    void Promise.allSettled(animations.map(animation => animation.finished)).then(() => {
      if (running.current === animations) cancel();
    });
    return cancel;
  }, [step]);

  async function leave(nextStep: string, nextDirection: Direction) {
    if (nextStep === step) return;
    direction.current = nextDirection;
    cancel();
    const element = contentRef.current;
    if (!element || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const sign = nextDirection === 'forward' ? -1 : 1;
    const distance = Math.min(element.clientWidth * .24, 160);
    element.dataset.swipeDirection = nextDirection;
    element.dataset.swipePhase = 'leaving';
    const animation = element.animate([
      { opacity: 1, transform: 'translate3d(0, 0, 0) rotate(0deg) scale(1)' },
      { opacity: 0, transform: `translate3d(${sign * distance}px, 0, 0) rotate(${sign * 1.2}deg) scale(.985)` },
    ], { duration: 180, fill: 'forwards', easing: 'cubic-bezier(.4,0,1,1)' });
    running.current = [animation];
    // Cancellation (navigation or reduced motion) must never prevent the commit.
    await animation.finished.catch(() => undefined);
  }

  return { contentRef, leave };
}
