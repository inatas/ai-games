import { useId } from 'react';

const star = 'M32 4 41 18 57 18 49 32 57 46 41 46 32 60 23 46 7 46 15 32 7 18 23 18Z';

/** Six-point sheriff badge shared by avatars and vote summaries. */
export function SheriffIcon() {
  const id = useId();
  return <svg viewBox="0 0 64 64" width="1em" height="1em" aria-hidden="true" focusable="false" style={{ verticalAlign: '-0.12em', overflow: 'visible' }}>
    <defs>
      <linearGradient id={`${id}-gold`} x1="0" y1="0" x2=".8" y2="1">
        <stop stopColor="#fff0b1"/><stop offset=".3" stopColor="#cbb46e"/>
        <stop offset=".52" stopColor="#9e7d39"/><stop offset=".7" stopColor="#dcc58a"/>
        <stop offset="1" stopColor="#775222"/>
      </linearGradient>
      <linearGradient id={`${id}-rim`} x1="0" y1="0" x2=".4" y2="1">
        <stop stopColor="#fff5cd"/><stop offset=".45" stopColor="#e3c878"/><stop offset="1" stopColor="#97703a"/>
      </linearGradient>
    </defs>
    <path d={star} fill={`url(#${id}-gold)`} stroke="#49331b" strokeWidth="6" strokeLinejoin="round"/>
    <path d={star} fill="none" stroke={`url(#${id}-rim)`} strokeWidth="3" strokeLinejoin="round"/>
    <path d={star} transform="translate(5.76 5.76) scale(.82)" fill="none" stroke="#71532a" strokeWidth="1.2" strokeLinejoin="round" opacity=".65"/>
    <path d="m32 8-7 13H12m5 11-6 11h13" fill="none" stroke="#fff3c3" strokeWidth="1.3" strokeLinecap="round" opacity=".8"/>
    <path d="m39 44 13-1m-12 2-8 12" fill="none" stroke="#67451f" strokeWidth="1.3" strokeLinecap="round" opacity=".7"/>
    <path d="m22 26 3-1m11 12 5-1m-12 7 2-1m10-19 2 1" fill="none" stroke="#624a27" strokeWidth=".8" strokeLinecap="round" opacity=".45"/>
    <path d="m23 27 3-1m10 12 4-1m-7-17 1-3" fill="none" stroke="#fff4ca" strokeWidth=".8" strokeLinecap="round" opacity=".65"/>
    <circle cx="29" cy="30" r=".8" fill="#fff3c0" opacity=".8"/>
  </svg>;
}
