import { useEffect, useRef, useState } from 'react';
import type { DemoSnapshot } from '../../../shared/werewolf.ts';
import { useRobotUsers } from './robot-context.tsx';
import { portraitStyle } from './seat-avatar.tsx';
import { summarizeVotes } from './presentation.ts';
import { buildHistoryTimeline, filterHistoryTimeline, type HistoryItem } from './history-timeline.ts';
import './speech-history.css';

const roleNames: Record<string, string> = { wolf: '狼人', villager: '村民', seer: '预言家', witch: '女巫', hunter: '猎人', idiot: '白痴' };

export function HistoryIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M12 5C9 3 5 3 2 4v15c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1Zm0 0v15M5 7h4M5 10h4M15 7h4M15 10h4"/></svg>;
}

function VoteCard({ item }: { item: Extract<HistoryItem, { kind: 'vote' }> }) {
  const rows = summarizeVotes(item.data);
  const name = item.election === 'sheriff' ? '警长竞选票型' : '放逐投票票型';
  const outcome = item.data.winner ? `${item.data.winner}号${item.election === 'sheriff' ? '当选警长' : '被放逐出局'}`
    : item.data.tied.length ? `${item.data.tied.join('、')}号平票${item.data.runoff ? '，警徽流失' : '，进入PK'}`
      : item.election === 'sheriff' ? '警徽流失' : '无人被放逐';
  return <article className="ww-history-vote" aria-label={name}>
    <h4>{name}{item.data.runoff ? ' · PK' : ''}</h4>
    {rows.map(row => <div className="ww-history-vote-row" key={row.target}>
      <b>{row.target === 'abstain' ? '弃票' : row.target === 'missing' ? '未投' : `${row.target}号`}</b>
      <span aria-hidden="true">←</span><span>{row.voters.map(seat => `${seat}号`).join('、') || '—'}</span>
      {row.total > 0 && <small>{row.total}票</small>}
    </div>)}
    <strong className="ww-history-vote-result">{outcome}</strong>
  </article>;
}

function NightCard({ item }: { item: Extract<HistoryItem, { kind: 'wolf-choices' | 'wolf-knife' | 'inspection' | 'medicine' }> }) {
  if (item.kind === 'wolf-choices') return <article className="ww-history-night-card"><span className="ww-history-night-icon wolf">♞</span><div><b>狼人选择</b><p>{item.choices.map(choice => `${choice.seat}号 → ${choice.target === null ? '空刀' : `${choice.target}号`}`).join('　')}</p></div></article>;
  if (item.kind === 'wolf-knife') return <article className="ww-history-night-card"><span className="ww-history-night-icon wolf">♞</span><div><b>最终狼刀</b><p>{item.target === null ? '空刀' : `${item.target}号`}</p></div></article>;
  if (item.kind === 'inspection') return <article className="ww-history-night-card"><span className="ww-history-night-icon seer">◉</span><div><b>预言家查验</b><p>{item.target}号 · {item.alignment === 'wolf' ? '狼' : '好'}</p></div></article>;
  const action = item.action.kind === 'save' ? `使用解药${item.knifeTarget ? ` · 救${item.knifeTarget}号` : ''}`
    : item.action.kind === 'poison' ? `使用毒药${item.action.target ? ` · 毒${item.action.target}号` : ''}` : '未使用药物';
  return <article className="ww-history-night-card"><span className="ww-history-night-icon witch">♙</span><div><b>女巫用药</b><p>{item.seat}号 · {action}</p></div></article>;
}

export function SpeechHistory({ game, close }: { game: DemoSnapshot; close: () => void }) {
  const [day, setDay] = useState<number | 'all'>(game.status === 'finished' ? 'all' : game.day);
  const dialog = useRef<HTMLDialogElement>(null);
  const messages = useRef<HTMLDivElement>(null);
  const users = useRobotUsers();
  const finished = game.status === 'finished';
  const items = filterHistoryTimeline(buildHistoryTimeline(game), day);
  const lastDay = game.day;
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => { if (messages.current) messages.current.scrollTop = 0; }, [day]);

  return <dialog className="ww-history" ref={dialog} aria-labelledby="history-title" onCancel={close} onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <header><h2 id="history-title">对局历史</h2><button type="button" aria-label="关闭对局历史" onClick={close}>×</button></header>
    <nav className="ww-history-days" aria-label="选择对局天数">
      <button type="button" aria-pressed={day === 'all'} onClick={() => setDay('all')}>整局</button>
      {Array.from({ length: lastDay }, (_, index) => index + 1).map(value => <button type="button" key={value} aria-pressed={value === day} onClick={() => setDay(value)}>第{value}天</button>)}
    </nav>
    <div className="ww-history-messages" ref={messages} tabIndex={0} role="region" aria-label="对局时间线">
      {items.length === 0 && <div className="ww-history-empty"><HistoryIcon/><p>暂无对局记录</p><small>公开发言和结算结果会按顺序出现在这里。</small></div>}
      {items.map((item, index) => {
        const previous = items[index - 1];
        const section = `${item.day}:${item.period}`;
        const previousSection = previous && `${previous.day}:${previous.period}`;
        const phase = item.kind === 'speech' ? item.phase : item.kind === 'announcement' ? '公开播报' : null;
        const previousPhase = previous?.kind === 'speech' ? previous.phase : previous?.kind === 'announcement' ? '公开播报' : null;
        const user = item.kind === 'speech' ? users.find(player => player.seat === item.seat)?.user : undefined;
        const role = item.kind === 'speech' && finished ? game.roles?.find(player => player.seat === item.seat)?.role : undefined;
        return <section key={`${item.day}-${item.period}-${item.sequence}-${item.kind}`}>
          {section !== previousSection && <h3 className="ww-history-period">第{item.day}{item.period === 'night' ? '夜' : '天'} · {item.period === 'night' ? '赛后揭晓' : '公开记录'}{item.period === 'night' && <span>仅终局显示</span>}</h3>}
          {phase && (phase !== previousPhase || section !== previousSection) ? <h4 className="ww-history-phase">{phase}</h4> : null}
          {item.kind === 'speech' && <article className="ww-speech" aria-label={`${item.seat}号玩家，${item.phase}`}>
            <div className="ww-speech-avatar" style={portraitStyle(item.seat, user)} aria-hidden="true"><b>{item.seat}</b></div>
            <div className="ww-speech-content"><h5>{item.seat}号 · {user?.nickname ?? '玩家'}{role && <small> · {roleNames[role]}</small>}</h5><div className="ww-speech-bubble">{item.text.split('\n\n').map((paragraph, paragraphIndex) => <p key={paragraphIndex}>{paragraph}</p>)}</div></div>
          </article>}
          {item.kind === 'vote' && <VoteCard item={item} />}
          {item.kind === 'announcement' && <article className="ww-history-announcement">{item.text}</article>}
          {item.kind === 'wolf-choices' || item.kind === 'wolf-knife' || item.kind === 'inspection' || item.kind === 'medicine' ? <NightCard item={item} /> : null}
        </section>;
      })}
    </div>
    <footer>{finished ? '终局身份已揭晓' : '仅显示已经公开的信息 · 对局继续进行'}</footer>
  </dialog>;
}
