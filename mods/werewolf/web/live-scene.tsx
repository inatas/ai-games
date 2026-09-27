import { useRobotUser, useRobotUsers } from './robot-context.tsx';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { speechKey, speechLayout, revealDuration, revealClip } from './speech-presentation.ts';
import type { DemoSnapshot } from '../shared/werewolf.ts';
import { portraitStyle } from './seat-avatar.tsx';
import { SheriffIcon } from './sheriff-icon.tsx';
import { boardVoteCopy, nextPresentation, summarizeVotes, type PresentationCursor, type PresentationItem, type VoteData } from './presentation.ts';
import './live-scene.css';

const avatars = ['brown', 'pink', 'blue'] as const;
function Cloud({ side }: { side: string }) {
  return <svg className={`ww-cloud cloud-${side}`} viewBox="0 0 180 90" aria-hidden="true">
    <defs><linearGradient id={`cloud-${side}`} x2="0" y2="1"><stop stopColor="#d0e9e9"/><stop offset=".5" stopColor="#91c5d6"/><stop offset="1" stopColor="#568da7"/></linearGradient></defs>
    <path d="M175 59c-21 23-58 23-84 17 14 8 27 8 40 7-27 12-53-6-70-7C29 77 7 65 9 46 0 27 23 15 37 23 47 3 80 8 84 26c22-7 39 5 35 21 20 11 37 11 56 12Z" fill={`url(#cloud-${side})`} stroke="#659caf" strokeWidth="1.5"/>
    <path d="M166 63c-27 10-54 7-75-2-17-8-36-7-46 0-15 7-32-2-28-15M35 44c-10-16 9-23 18-12 8 12-9 24-20 14M60 27c18-13 35 8 23 19-10 8-22-1-17-8M92 43c12-8 22 3 17 11M30 65c18 6 27-3 41 0 19 5 35 12 61 8" fill="none" stroke="#649cb7" strokeWidth="2" strokeLinecap="round"/>
    <path d="M19 31c8-9 16-8 20-3M46 20c14-10 27-3 31 5M95 33c9-2 15 2 17 7M22 58c8 6 15 5 23 2" fill="none" stroke="#d4eeee" strokeWidth="2" strokeLinecap="round" opacity=".65"/>
  </svg>;
}
export function SpeakerAvatar({ seat }: { seat: number | null }) {
  const user = useRobotUser(seat);
  if (seat === null) return null;
  const avatar = user?.portrait.variant ?? avatars[(seat - 1) % avatars.length];
  return <section className="ww-speaker" aria-label={`${seat}号玩家正在发言`}>
    <img className={`ww-user-avatar avatar-${avatar}`} src={user?.portrait.src ?? `/werewolf/user-avatar-${avatar}.png`} alt={`${seat}号玩家的用户Avatar`} />
    <div className="ww-seat-bubble" aria-hidden="true">{seat}</div>
    <div className="ww-nameplate ww-speaker-name"><b>{user?.nickname ?? `${seat}号玩家`}</b><small>正在发言</small></div>
  </section>;
}

export function VoteSummary({ event }: { event: DemoSnapshot['events'][number] }) {
  const data = event.data as unknown as VoteData;
  const copy = boardVoteCopy(event.type === 'sheriff-votes' ? 'sheriff' : 'exile', data, event.day);
  return <section className="ww-vote-summary" aria-label={copy.ariaLabel}>
    <h3>{copy.title}</h3>
    {summarizeVotes(data).map(row => <div className="ww-vote-row" key={row.target}>
      <div className="ww-vote-target"><b>{typeof row.target === 'number' ? row.target : row.target === 'abstain' ? '弃票' : '未投'}</b>{typeof row.target === 'number' && <small>{row.total}票</small>}</div>
      <span className="ww-vote-arrow" aria-label="投给">←</span>
      <div className="ww-vote-voters">{row.voters.map(seat => <span key={seat} title={seat === data.sheriff ? '警长 · 1.5票' : '1票'}>{seat}{seat === data.sheriff && <sup><SheriffIcon/></sup>}</span>)}</div>
    </div>)}
    <p>{copy.outcome}</p>
    {data.sheriff !== null && <small><SheriffIcon/> 警长{data.sheriff}号 · 1.5票</small>}
  </section>;
}

export function LiveTransition({ game, suppressed, reduced = false }: { game: DemoSnapshot; suppressed: boolean; reduced?: boolean }) {
  const users = useRobotUsers();
  const cursor = useRef<PresentationCursor | null>(null);
  const [queue, setQueue] = useState<PresentationItem[]>([]);
  useEffect(() => {
    const result = nextPresentation(cursor.current, game, suppressed);
    cursor.current = result.cursor;
    if (game.status !== 'running') setQueue([]);
    else if (suppressed) setQueue(current => current.filter(item => item.kind === 'deaths' && item.day === game.day && item.id.startsWith(`${game.id}:`)));
    else setQueue(current => [...current.filter(item => item.day === game.day && item.id.startsWith(`${game.id}:`) && (item.kind === 'deaths' || item.kind === game.period)), ...result.items]);
  }, [game, suppressed]);
  const item = queue[0];
  useEffect(() => {
    if (!item || suppressed) return;
    const timeout = window.setTimeout(() => setQueue(current => current.slice(1)), item.kind === 'deaths' ? 3000 : reduced ? 300 : 2000);
    return () => window.clearTimeout(timeout);
  }, [item?.id, suppressed, reduced]);
  if (!item || suppressed) return null;
  const deaths = item.kind === 'deaths';
  return <div key={item.id} className={`ww-transition transition-${item.kind}`} role="status" aria-label={deaths ? '昨夜出局公告' : '昼夜过场'}>
    {deaths ? <>
      <h2>出局公告</h2>
      <p>{item.seats.length ? <>昨夜 <strong>{item.seats.map(seat => `${seat}号`).join('、')}</strong> 玩家出局</> : '昨夜平安夜，无人出局'}</p>
      <div className="ww-grave-scene" aria-hidden="true"><svg className="ww-raven" viewBox="0 0 100 100"><path d="M20 93 39 55C22 38 38 20 57 27 63 7 82 14 85 26L99 32 83 37C82 57 66 66 53 67L42 89 40 67Z" fill="#20282c" stroke="#677176" strokeWidth="2"/><path d="m40 48 24-9-12 24M57 66l6 14m5-18 8 16" fill="none" stroke="#879095" strokeWidth="2"/><circle cx="77" cy="26" r="2" fill="#e2d491"/></svg><div className="ww-grave-sign">{item.seats.length ? '出局' : '平安'}</div><i/><div className="ww-grass">❧ ❧ ❧</div></div>
      <div className="ww-departed">{item.seats.map(seat => <div key={seat}><span style={portraitStyle(seat, users.find(player => player.seat === seat)?.user)}/><b>{seat}号</b></div>)}</div>
      <small>具体遗言与技能按规则继续结算</small>
      <button onClick={() => setQueue(current => current.slice(1))} aria-label="关闭出局公告">知道了</button>
    </> : <><div className="ww-sky"><Cloud side="left"/><div className="ww-orb"/><Cloud side="right"/></div><h2>{item.kind === 'night' ? '天黑了，请闭眼' : '天亮了，请睁眼'}</h2></>}
  </div>;
}


export function SpeechBubble({ game, suppressed = false, reduced = false }: { game: DemoSnapshot; suppressed?: boolean; reduced?: boolean }) {
  const key = speechKey(game);
  if (!key) return null;
  return <CurrentSpeech key={key} game={game} suppressed={suppressed} reduced={reduced}/>;
}

function CurrentSpeech({ game, suppressed, reduced }: { game: DemoSnapshot; suppressed: boolean; reduced: boolean }) {
  const speech = game.currentSpeech!;
  const user = useRobotUser(speech.seat);
  const [closed, setClosed] = useState(false);
  const [height, setHeight] = useState(20);
  const paper = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const initialRemaining = useRef(game.timing.remainingMs);
  const complete = useRef(false);
  const layout = speechLayout(speech.seat, height);

  useLayoutEffect(() => {
    const element = paper.current;
    if (!element) return;
    const stage = element.closest('.ww-stage')!;
    const measure = () => setHeight(element.getBoundingClientRect().height / stage.getBoundingClientRect().height * 100);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const element = text.current;
    if (!element) return;
    let frame = 0;
    const finish = () => { complete.current = true; element.style.setProperty('--speech-clip', 'none'); cancelAnimationFrame(frame); };
    // Never replay text the viewer has already seen behind another panel or in the background.
    if (complete.current || closed || suppressed || reduced || document.hidden) { finish(); return; }
    const lineHeight = parseFloat(getComputedStyle(element).lineHeight);
    const lines = Math.max(1, Math.round(element.scrollHeight / lineHeight));
    const duration = revealDuration(lines, initialRemaining.current);
    const start = performance.now();
    const reveal = (now: number) => {
      element.style.setProperty('--speech-clip', revealClip(now - start, duration, lines, lineHeight));
      if (now - start < duration) frame = requestAnimationFrame(reveal);
      else finish();
    };
    reveal(start);
    document.addEventListener('visibilitychange', finish);
    window.addEventListener('resize', finish);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', finish);
      window.removeEventListener('resize', finish);
    };
  }, [closed, suppressed, reduced, speech.text]);

  const tip = layout.tailOffset * 2;
  const minY = Math.min(-2, tip - .5);
  const tailHeight = Math.max(2, tip + .5) - minY;
  const style = {
    top: `${layout.top}%`, '--speech-max-height': `${layout.maxHeight * 2}cqw`,
    '--tail-top': `${layout.tail * 2 + minY}cqw`, '--tail-height': `${tailHeight}cqw`,
  } as CSSProperties;
  return <>
    <section hidden={closed || suppressed} className={`ww-live-speech-bubble ${layout.right ? 'points-right' : 'points-left'}`} aria-label={`${speech.seat}号当前发言`} style={style}>
      <div className="ww-speech-paper" ref={paper}>
        <header><strong title={user?.nickname}>{speech.seat}号 · {user?.nickname ?? '玩家'}</strong><button aria-label="关闭当前发言" onClick={() => setClosed(true)}>×</button></header>
        <div className="ww-speech-body" tabIndex={0} aria-label="当前发言正文"><div className="ww-speech-text" ref={text}>{speech.text}</div></div>
      </div>
      <svg className="ww-speech-tail" viewBox={`0 ${minY} 4 ${tailHeight}`} aria-hidden="true"><path d={layout.right ? `M0 -2 L4 ${tip} L0 2` : `M4 -2 L0 ${tip} L4 2`}/></svg>
    </section>
    {closed && !suppressed && <button className="ww-speech-reopen" onClick={() => setClosed(false)} aria-label="显示当前发言">显示发言</button>}
  </>;
}
