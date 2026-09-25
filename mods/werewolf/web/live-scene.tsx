import { useRobotUser, useRobotUsers } from './robot-context.tsx';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { DemoSnapshot } from '../shared/werewolf.ts';
import { portraitStyle } from './seat-avatar.tsx';
import { boardVoteCopy, nextPresentation, summarizeVotes, type PresentationCursor, type PresentationItem, type VoteData } from './presentation.ts';
import './live-scene.css';

const avatars = ['brown', 'pink', 'blue'] as const;
function Cloud({ side }: { side: string }) {
  return <svg className={`ww-cloud cloud-${side}`} viewBox="0 0 160 65" aria-hidden="true"><path d="M9 51C-3 40 8 25 24 29c-3-18 25-25 37-12C71-3 100 2 103 19c19-9 36 2 34 16 25-4 31 18 10 24L25 60Z" fill="#a8cad2" stroke="#6d98a7" strokeWidth="2"/><path d="M24 40c17-12 39 12 58-2s33 9 52 4M42 29c7-8 19-3 19 5" fill="none" stroke="#709ba9" strokeWidth="2"/></svg>;
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
      <div className="ww-vote-voters">{row.voters.map(seat => <span key={seat} title={seat === data.sheriff ? '警长 · 1.5票' : '1票'}>{seat}{seat === data.sheriff && <sup>♛</sup>}</span>)}</div>
    </div>)}
    <p>{copy.outcome}</p>
    {data.sheriff !== null && <small>♛ 警长{data.sheriff}号 · 1.5票</small>}
  </section>;
}

export function LiveTransition({ game, suppressed }: { game: DemoSnapshot; suppressed: boolean }) {
  const users = useRobotUsers();
  const cursor = useRef<PresentationCursor | null>(null);
  const [queue, setQueue] = useState<PresentationItem[]>([]);
  useEffect(() => {
    const result = nextPresentation(cursor.current, game, suppressed);
    cursor.current = result.cursor;
    if (game.status !== 'running') setQueue([]);
    else if (suppressed) setQueue(current => current.filter(item => item.kind === 'deaths' && item.day === game.day && item.id.startsWith(`${game.id}:`)));
    else setQueue(current => [...current.filter(item => item.day === game.day && item.id.startsWith(`${game.id}:`)), ...result.items]);
  }, [game, suppressed]);
  const item = queue[0];
  useEffect(() => {
    if (!item || suppressed) return;
    const timeout = window.setTimeout(() => setQueue(current => current.slice(1)), item.kind === 'deaths' ? 3000 : 2000);
    return () => window.clearTimeout(timeout);
  }, [item?.id, suppressed]);
  if (!item || suppressed) return null;
  const deaths = item.kind === 'deaths';
  return <div className={`ww-transition transition-${item.kind}`} role="status" aria-label={deaths ? '昨夜出局公告' : '昼夜过场'}>
    {deaths ? <>
      <h2>出局公告</h2>
      <p>{item.seats.length ? <>昨夜 <strong>{item.seats.map(seat => `${seat}号`).join('、')}</strong> 玩家出局</> : '昨夜平安夜，无人出局'}</p>
      <div className="ww-grave-scene" aria-hidden="true"><svg className="ww-raven" viewBox="0 0 100 100"><path d="M20 93 39 55C22 38 38 20 57 27 63 7 82 14 85 26L99 32 83 37C82 57 66 66 53 67L42 89 40 67Z" fill="#20282c" stroke="#677176" strokeWidth="2"/><path d="m40 48 24-9-12 24M57 66l6 14m5-18 8 16" fill="none" stroke="#879095" strokeWidth="2"/><circle cx="77" cy="26" r="2" fill="#e2d491"/></svg><div className="ww-grave-sign">{item.seats.length ? '出局' : '平安'}</div><i/><div className="ww-grass">❧ ❧ ❧</div></div>
      <div className="ww-departed">{item.seats.map(seat => <div key={seat}><span style={portraitStyle(seat, users.find(player => player.seat === seat)?.user)}/><b>{seat}号</b></div>)}</div>
      <small>具体遗言与技能按规则继续结算</small>
      <button onClick={() => setQueue(current => current.slice(1))} aria-label="关闭出局公告">知道了</button>
    </> : <><div className="ww-sky"><Cloud side="left"/><div className="ww-orb"/><Cloud side="right"/></div><h2>{item.kind === 'night' ? '天黑了，请闭眼' : '天亮了，请睁眼'}</h2><p>第{item.day}{item.kind === 'night' ? '夜' : '天'}</p></>}
  </div>;
}


export function SpeechBubble({ game }: { game: DemoSnapshot }) {
  const speech = game.currentSpeech;
  if (game.status !== 'running' || game.period !== 'day' || !speech || speech.seat !== game.speakerSeat) return null;
  const row = (speech.seat - 1) % 6;
  const right = speech.seat > 6;
  // Seat centres are 17.55% + row * 9.85% of the scene height.
  const target = 17.55 + row * 9.85;
  const anchor = Math.min(51, Math.max(17, target));
  return <section className={`ww-live-speech-bubble ${right ? 'points-right' : 'points-left'}`} aria-label={`${speech.seat}号当前发言`} style={{ '--tail-y': `${(anchor - 13) / 42 * 100}%`, '--tail-drop': `${(target - anchor) * 2}cqw` } as CSSProperties}>
    <svg className="ww-speech-tail" viewBox="0 0 30 30" preserveAspectRatio="none" aria-hidden="true"><path d={right ? 'M0 1 L28 28 L0 23' : 'M30 1 L2 28 L30 23'} fill="#e7d1a0" stroke="#51351e" strokeWidth="2"/></svg>
    <div className="ww-speech-paper">
      <header><strong>{speech.seat}号玩家 · {game.phaseLabel}</strong><small>发言中</small></header>
      <div key={`${game.id}:${speech.revision}`} className="ww-speech-body" tabIndex={0} aria-label="当前发言正文">{speech.text}</div>
    </div>
  </section>;
}
