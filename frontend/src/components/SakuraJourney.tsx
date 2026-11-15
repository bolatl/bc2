import { useId } from 'react';
import type { Fight } from '../api/types';
import '../styles/sakura-journey.css';

const branchSteps = [
  { stage: 'thermometer_start', x: 80, y: 158 },
  { stage: 'facts', x: 260, y: 124 },
  { stage: 'feelings', x: 440, y: 146 },
  { stage: 'needs', x: 620, y: 110 },
  { stage: 'partner_view', x: 800, y: 133 },
  { stage: 'rehearsal', x: 980, y: 88 },
  { stage: 'thermometer_end', x: 1160, y: 111 },
  { stage: 'ready', x: 1340, y: 78 },
] as const;

const branchPath = `M -80 192 C -20 192 20 158 80 158 ${branchSteps.slice(1).map((point, index) => {
  const previous = branchSteps[index];
  return `C ${previous.x + 80} ${previous.y} ${point.x - 80} ${point.y} ${point.x} ${point.y}`;
}).join(' ')} C 1410 78 1430 35 1510 36`;

function Blossom({ x, y, opened, active = false, small = false }: { x: number; y: number; opened: boolean; active?: boolean; small?: boolean }) {
  return <g transform={`translate(${x} ${y})`} className={`journey-blossom ${opened ? 'is-open' : ''} ${active ? 'is-current' : ''}`}>
    <g className="journey-petals" style={{ transform: `scale(${opened ? small ? .63 : 1 : .25})` }}>
      {[0, 72, 144, 216, 288].map(angle => <path key={angle} transform={`rotate(${angle})`} d="M 0 1 C -13 -3 -17 -17 -8 -23 Q -3 -27 0 -22 Q 4 -27 9 -23 C 18 -17 13 -4 0 1 Z" />)}
      <circle className="journey-flower-center" r="3.5" />
      {[0, 72, 144, 216, 288].map(angle => <g key={angle} transform={`rotate(${angle})`} className="journey-stamen"><path d="M 0 0 L 0 -9" /><circle cy="-9" r="1.3" /></g>)}
    </g>
    {!opened && <ellipse className="journey-bud" rx="4" ry="6" transform="rotate(-20)" />}
  </g>;
}

/** The artwork follows actual server stages; it is not a promise of future steps. */
export function SakuraJourney({ stage, label, turns, checkpoint = false }: { stage: string; label: string; turns: Fight['turns']; checkpoint?: boolean }) {
  const captionId = useId();
  const current = branchSteps.find(point => point.stage === stage) ?? branchSteps[0];
  const answered = new Set(turns.map(turn => turn.stage));
  return <figure className="sakura-journey" data-stage={stage} data-checkpoint={checkpoint || undefined} aria-labelledby={captionId}>
    <div className="journey-window">
      <svg viewBox="0 0 280 225" fill="none" aria-hidden="true" focusable="false">
        <g className="journey-camera" style={{ transform: `translate(${140 - current.x}px, ${116 - current.y}px)` }}>
          <path className="journey-branch-shadow" d={branchPath} />
          <path className="journey-branch" d={branchPath} />
          {branchSteps.map((point, index) => {
            const isCurrent = point.stage === stage;
            const opened = isCurrent || answered.has(point.stage);
            const side = index % 2 === 0 ? -1 : 1;
            return <g key={point.stage}>
              <path className="journey-twig" d={`M ${point.x - 18} ${point.y + 2} Q ${point.x - 2} ${point.y - 11} ${point.x + 24} ${point.y - 43} M ${point.x + 12} ${point.y - 26} Q ${point.x + 35} ${point.y - 31} ${point.x + 45} ${point.y - 28} M ${point.x + 67} ${point.y - 1} Q ${point.x + 85} ${point.y + side * 18} ${point.x + 90} ${point.y + side * 40}`} />
              <path className="journey-leaf" d={`M ${point.x + 62} ${point.y} Q ${point.x + 77} ${point.y + 18} ${point.x + 91} ${point.y + 14} Q ${point.x + 82} ${point.y - 2} ${point.x + 62} ${point.y}`} />
              <Blossom x={point.x + 24} y={point.y - 43} opened={opened} small />
              <Blossom x={point.x + 45} y={point.y - 28} opened={opened} small />
              <Blossom x={point.x + 90} y={point.y + side * 40} opened={opened} small />
              {isCurrent && <circle className="journey-current-halo" cx={point.x} cy={point.y} r="37" />}
              <Blossom x={point.x} y={point.y} opened={opened} active={isCurrent} />
            </g>;
          })}
        </g>
      </svg>
      <span className="journey-pollen journey-pollen-one" aria-hidden="true" />
      <span className="journey-pollen journey-pollen-two" aria-hidden="true" />
    </div>
    <figcaption id={captionId}><span>{checkpoint ? 'A moment to check in' : 'Current step'}</span><strong>{label}</strong></figcaption>
  </figure>;
}
