import { useId } from 'react';

// A small, code-native botanical drawing. No images or third-party requests.
export function SakuraBough({ className = '' }: { className?: string }) {
  const flower = useId();
  const blossoms = [
    [179, 355, 1.1, -15], [224, 311, .8, 28], [264, 338, .68, 10],
    [243, 229, .9, 17], [291, 210, 1.1, -10], [315, 247, .7, 30],
    [368, 333, .9, 22], [390, 289, .7, 0], [428, 316, 1.2, 6],
    [451, 212, 1.1, -7], [494, 182, .8, 32], [476, 249, .65, 19],
    [423, 116, .8, -15], [451, 85, .6, 5], [533, 296, .85, 20],
    [573, 313, .6, -20], [585, 214, .8, 6], [618, 176, 1, 30],
    [658, 205, .7, -10], [690, 121, .9, 10], [735, 95, .65, 30],
    [659, 67, .65, -8], [779, 175, 1, 20], [817, 148, .65, 0],
  ];
  return <svg className={`sakura-bough ${className}`} viewBox="0 0 860 600" fill="none" aria-hidden="true" focusable="false">
    <defs><g id={flower}>
      {[0, 72, 144, 216, 288].map(angle => <path key={angle} transform={`rotate(${angle})`} d="M0 2C-9-1-18-12-13-21C-9-28-3-24 0-20C3-24 9-28 13-21C18-12 9-1 0 2Z" fill="var(--petal, #EFB3C6)" stroke="var(--petal-edge, #C77D9B)" strokeWidth=".7" />)}
      <circle r="3.5" fill="var(--accent, #F0A04B)" />
      {[0, 60, 120, 180, 240, 300].map(angle => <g key={angle} transform={`rotate(${angle})`}><path d="M0 0V-10" stroke="var(--accent, #F0A04B)" strokeWidth=".7" /><circle cy="-10" r="1.2" fill="var(--accent, #F0A04B)" /></g>)}
    </g></defs>
    <g stroke="var(--branch, #493B39)" strokeLinecap="round" strokeLinejoin="round">
      <path d="M-45 616C95 551 105 438 252 389S401 284 541 232S693 167 848 105" strokeWidth="9" />
      <path d="M98 511C145 437 159 413 181 352M169 432C223 403 258 377 269 340M248 390C274 337 282 270 288 209M278 294C250 274 244 251 242 228" strokeWidth="4" />
      <path d="M308 364C370 342 391 339 428 317M383 318L389 289M425 277C438 222 456 191 451 150S432 118 421 115M449 148L452 86" strokeWidth="3.5" />
      <path d="M455 267C476 219 487 201 495 181M470 227L477 250M509 244C531 263 537 287 534 296L573 313M556 226L587 215M592 210C605 190 618 175 659 205" strokeWidth="3" />
      <path d="M628 194C657 157 673 118 659 67M678 133L691 120L735 95M693 166C738 150 744 151 778 175L818 149" strokeWidth="2.8" />
    </g>
    <path d="M-45 616C95 551 105 438 252 389S401 284 541 232S693 167 848 105" stroke="var(--accent, #F0A04B)" strokeWidth="1.3" strokeDasharray="2 10" strokeLinecap="round" opacity=".65" />
    <g fill="var(--leaf, #8EAA9D)" opacity=".8"><path d="M342 352Q316 307 342 302Q356 327 342 352Z" /><path d="M554 231Q547 191 570 184Q578 211 554 231Z" /><path d="M720 158Q716 122 742 126Q742 147 720 158Z" /><path d="M217 404Q192 370 212 360Q231 378 217 404Z" /></g>
    {blossoms.map(([x, y, scale, rotation], index) => <use key={index} href={`#${flower}`} transform={`translate(${x} ${y}) rotate(${rotation}) scale(${scale})`} opacity={index % 3 === 0 ? '.92' : '.72'} />)}
    <g fill="var(--petal, #EFB3C6)" opacity=".5"><ellipse cx="384" cy="418" rx="5" ry="10" transform="rotate(28 384 418)" /><ellipse cx="589" cy="395" rx="4" ry="9" transform="rotate(-30 589 395)" /><ellipse cx="698" cy="298" rx="4" ry="8" transform="rotate(30 698 298)" /></g>
  </svg>;
}

export function SakuraBackdrop() {
  return <div className="sakura-backdrop" aria-hidden="true"><SakuraBough className="sakura-backdrop-right" /><SakuraBough className="sakura-backdrop-left" /></div>;
}
