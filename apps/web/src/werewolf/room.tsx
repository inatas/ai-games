import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { DemoSnapshot } from '../../../shared/werewolf.ts';
import './room.css';

type Event = DemoSnapshot['events'][number];
type Modal = 'settings' | 'restart' | 'votes' | 'player' | 'roles' | 'replay' | null;
const roleNames: Record<string, string> = { wolf: '狼人', villager: '村民', seer: '预言家', witch: '女巫', hunter: '猎人', idiot: '白痴' };
const preview: DemoSnapshot = {
  id: 'preview', revision: 0, status: 'running', day: 2, period: 'day', phaseLabel: '放逐投票', actor: 5,
  progress: { submitted: 5, eligible: 9 }, sheriff: 1,
  players: Array.from({ length: 12 }, (_, i) => ({ seat: i + 1, alive: ![3, 8].includes(i + 1), ...(i === 9 ? { revealedRole: 'idiot' as const } : {}) })),
  events: [
    { type: 'sheriff-result', data: { seat: 1 } },
    { type: 'night-deaths', data: { seats: [3, 8] } },
    { type: 'speech', data: { seat: 5, text: '' } },
  ], result: null,
};

async function request(path: string, body?: object): Promise<DemoSnapshot> {
  const response = await fetch(`/api/werewolf/demo${path}`, body ? {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  } : undefined);
  if (response.status === 409 && path.endsWith('/step')) return request(path.slice(0, -5));
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(error?.error ?? '连接中断，请重试');
  }
  return response.json() as Promise<DemoSnapshot>;
}
function describe(event: Event): string {
  const data = event.data as { seat?: number | null; seats?: number[]; target?: number | null; winner?: string; direction?: string };
  const seats = data.seats?.map(seat => `${seat}号`).join('、');
  switch (event.type) {
    case 'sheriff-result': return data.seat ? `${data.seat}号 当选警长` : '警徽流失 · 本局无警长';
    case 'night-deaths': return data.seats?.length ? `昨夜 ${seats} 出局` : '昨夜平安夜，无人出局';
    case 'speech': return '本轮发言已静默跳过';
    case 'sheriff-speech': return '竞选发言已静默跳过';
    case 'last-words': return `${data.seat}号 遗言已静默跳过`;
    case 'sheriff-candidates': return `上警名单：${seats || '无人上警'}`;
    case 'sheriff-withdrawal': return `${data.seat}号 退水`;
    case 'sheriff-pk': return `警长平票：${seats} 进入PK`;
    case 'speaking-order': return `发言顺序：${seats}`;
    case 'exile-votes': return '放逐投票结果';
    case 'exiled': return `${data.seat}号 被放逐出局`;
    case 'idiot-revealed': return `${data.seat}号 白痴翻牌，失去投票权`;
    case 'wolf-explosion': return `${data.seat}号 狼人自爆`;
    case 'hunter-shot': return `${data.seat}号 猎人${data.target ? `开枪带走 ${data.target}号` : '未开枪'}`;
    case 'badge-transfer': return data.target ? `警徽移交给 ${data.target}号` : '警徽流失';
    case 'game-result': return data.winner === 'wolf' ? '狼人阵营获胜' : data.winner === 'good' ? '好人阵营获胜' : '双方平局';
    case 'sheriff-ballot': return `${data.seat}号 警长票 → ${data.target ?? '弃票'}`;
    case 'inspection': return '预言家查验记录';
    case 'medicine': return '女巫用药记录';
    case 'wolf-choices': return '狼人夜间投票';
    default: return '公开结算记录';
  }
}
function compact(events: Event[]): Event[] {
  return events.filter((event, index) => !['speech', 'sheriff-speech'].includes(event.type) || events[index - 1]?.type !== event.type);
}

// Cropped art comes from the approved atlas; all labels, state and controls are DOM elements.
function portraitStyle(seat: number): CSSProperties {
  const artSeat = seat === 3 ? 6 : seat === 8 ? 9 : seat;
  const x = artSeat <= 6 ? 29 : 747;
  const y = 250 + ((artSeat - 1) % 6) * 174;
  return { backgroundSize: '964.13% 1928.26%', backgroundPosition: `${x / (887 - 92) * 100}% ${y / (1774 - 92) * 100}%` };
}
function Dialog({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="ww-dialog" aria-label={title} onCancel={close} onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <header><h2>{title}</h2><button onClick={close} aria-label="关闭">×</button></header>{children}
  </dialog>;
}
export default function WerewolfRoom() {
  const [game, setGame] = useState<DemoSnapshot>(preview);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [selected, setSelected] = useState(5);
  const [modal, setModal] = useState<Modal>(null);
  const [expanded, setExpanded] = useState(true);
  const [reduced, setReduced] = useState(false);
  const [largeText, setLargeText] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [seed, setSeed] = useState(42);
  const [activeSeed, setActiveSeed] = useState(42);
  const [strategy, setStrategy] = useState<'fixed' | 'random'>('random');
  const [replayIndex, setReplayIndex] = useState(0);
  const [voteIndex, setVoteIndex] = useState(-1);
  const [atLatest, setAtLatest] = useState(true);
  const log = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);
  const isPreview = game.id === 'preview';
  const ended = game.status === 'finished';
  const night = game.period === 'night';
  const votes = game.events.filter(event => event.type === 'exile-votes');
  const vote = votes[voteIndex < 0 ? votes.length - 1 : voteIndex];
  const selectedPlayer = game.players.find(player => player.seat === selected)!;
  const selectedRole = game.roles?.find(player => player.seat === selected)?.role;
  const result = game.events.findLast(event => event.type === 'game-result');
  const events = compact(game.events);

  async function advance(create = false, autoplay = false) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setError('');
    try {
      const next = create || isPreview ? await request('', { seed, strategy }) : await request(`/${game.id}/step`, { revision: game.revision });
      setGame(next);
      if (create || isPreview) setActiveSeed(seed);
      if (create) setPlaying(autoplay);
      if (next.status !== 'running') setPlaying(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '暂时无法继续'); setPlaying(false); }
    finally { setBusy(false); inFlight.current = false; }
  }
  useEffect(() => {
    if (!playing || modal || busy || game.status !== 'running') return;
    const timer = window.setTimeout(() => void advance(), 800 / speed);
    return () => window.clearTimeout(timer);
  }, [playing, modal, busy, speed, game]);
  useEffect(() => {
    if (!isPreview && atLatest && log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [game.events.length, expanded]);
  function togglePlay() {
    if (isPreview) void advance(true, true);
    else setPlaying(value => !value);
  }
  function openVotes(index = -1) { setVoteIndex(index); setModal('votes'); }
  const status = error ? error : ended ? '对局结束 · 身份已揭晓' : isPreview ? '5号 · 正在投票' : game.status !== 'running' ? '演示已停止，请重开' : !playing ? '演示已暂停' : night ? '天黑请闭眼 · 夜间行动' : game.actor ? `${game.actor}号 · ${game.phaseLabel}` : game.phaseLabel;

  return <div className="ww-page"><main className={`ww-stage ${night ? 'is-night' : ''} ${reduced ? 'reduced-motion' : ''} ${largeText ? 'large-text' : ''}`} aria-label="狼人杀旁观房间">
    <div className="ww-background" />
    <a className="ww-back ww-round" href="/" aria-label="返回首页">◀</a>
    <div className="ww-room"><small>房间号：</small><b>{isPreview ? '000042' : String(activeSeed).padStart(6, '0')}</b></div>
    <div className="ww-day"><span>{night ? '☾' : '☀'}</span><b>第{game.day}{night ? '夜' : '天'}</b></div>
    <div className="ww-type"><small>房间类型：</small><b>12人预女猎白</b></div>
    <button className="ww-settings ww-round" aria-label="设置" onClick={() => setModal('settings')}>⚙</button>
    <section className={`ww-records ${expanded ? '' : 'collapsed'}`} aria-label="公开记录">
      <h1>{ended ? result && describe(result) : `第${game.day}${night ? '夜' : '天'} · ${game.phaseLabel}`}</h1>
      <div className="ww-log" ref={log} onScroll={() => { const element = log.current!; setAtLatest(element.scrollHeight - element.scrollTop - element.clientHeight < 20); }}>
        {events.length === 0 && <div className="ww-card">{night ? '天黑请闭眼。夜间行动结束后，将公布公开结果。' : '等待公开结果'}</div>}
        {events.map((event, index) => <div className="ww-card" key={index}>{describe(event)}{event.type === 'exile-votes' && <button className="ww-green" onClick={() => openVotes(game.events.slice(0, game.events.indexOf(event)).filter(item => item.type === 'exile-votes').length)}>查看详情</button>}</div>)}
        {!ended && <div className="ww-card ww-progress">{game.phaseLabel}{night ? '中' : '进行中'}{game.progress && <strong>已提交 {game.progress.submitted} / {game.progress.eligible}</strong>}</div>}
        {isPreview && <><div className="ww-divider">公开记录</div><div className="ww-card ww-preview-vote">第1天投票结果<button className="ww-green" onClick={() => openVotes()}>查看详情</button></div></>}
      </div>
      {!atLatest && expanded && <button className="ww-latest" onClick={() => { log.current!.scrollTop = log.current!.scrollHeight; setAtLatest(true); }}>回到最新 ↓</button>}
    </section>
    <button className="ww-record-toggle" onClick={() => setExpanded(value => !value)} aria-expanded={expanded}><span>{expanded ? '⋀' : '⋁'}</span>公开记录<span>{expanded ? '⋀' : '⋁'}</span></button>
    <div className={`ww-status ${error ? 'has-error' : ''}`} role="status">{status}{error && <button onClick={() => void advance()}>重试</button>}</div>
    {game.players.map(player => <button key={player.seat} className={`ww-seat ${player.seat > 6 ? 'right' : 'left'} ${player.alive ? '' : 'dead'} ${selected === player.seat ? 'selected' : ''} ${game.actor === player.seat && !night ? 'active' : ''}`} style={{ '--row': (player.seat - 1) % 6, '--side': player.seat <= 6 ? 0 : 1 } as CSSProperties} onClick={() => { setSelected(player.seat); setModal('player'); }} aria-label={`${player.seat}号玩家，${player.alive ? '存活' : '已出局'}${player.revealedRole ? '，白痴已翻牌' : ''}`}>
      <span className="ww-avatar" style={player.alive ? portraitStyle(player.seat) : { backgroundSize: '704% 1408%', backgroundPosition: '3.94% 36.2%' }} /><span className="ww-seat-number">{player.seat}</span>
      {game.sheriff === player.seat && <span className="ww-badge">♛<small>警长</small></span>}
      {player.revealedRole && <span className="ww-role-badge">白痴</span>}
      {ended && <span className="ww-revealed">{roleNames[game.roles?.find(item => item.seat === player.seat)?.role ?? '']}</span>}
    </button>)}
    <div className={`ww-character ${selected === 5 ? 'villager-art' : 'portrait-art'}`} style={selected !== 5 ? portraitStyle(selected) : undefined} aria-hidden="true" />
    <div className="ww-seat-bubble" aria-hidden="true">{selected}</div>
    <div className="ww-observer">◉ 旁观中</div>
    <button className="ww-play ww-round" onClick={togglePlay} disabled={game.status !== 'running' || busy} aria-label={playing ? '暂停演示' : '播放演示'}><span>{playing ? 'Ⅱ' : '▶'}</span>{playing ? '暂停' : '播放'}</button>
    <button className="ww-step ww-round" onClick={() => { setPlaying(false); void advance(); }} disabled={playing || game.status !== 'running' || busy} aria-label="单步推进"><span>▸▸</span>单步</button>
    <div className="ww-nameplate"><b>{selected}号玩家</b><span className="ww-identity">{selectedRole ? roleNames[selectedRole] : selectedPlayer.revealedRole ? '白痴' : '?'}</span><small>{selectedPlayer.alive ? '静默旁观' : '已出局'}</small></div>
    <nav className="ww-controls" aria-label="演示控制">
      {ended ? <><button onClick={() => setModal('roles')}>查看身份</button><button onClick={() => { setReplayIndex(0); setModal('replay'); }}>完整回放</button></> : <><button className="ww-autoplay" onClick={togglePlay} disabled={busy}>▷ {playing ? '自动演示' : isPreview ? '开始演示' : '继续演示'}</button><div className="ww-speeds">{[1, 2, 4].map(value => <button key={value} aria-pressed={speed === value} onClick={() => setSpeed(value)}>{value}×</button>)}</div></>}
      <button className="ww-restart" onClick={() => setModal('restart')}>⟳ {ended ? '再来一局' : '重开'}</button>
    </nav>
    <p className="ww-caption">{isPreview ? '画面预览 · 点击开始演示' : ended ? '静默对局 · 终局公开' : '无模型 · 静默自动对局'}</p>
    {modal && <Dialog title={{ settings: '显示设置', restart: '开启新对局', votes: '放逐投票详情', player: `${selected}号玩家`, roles: '终局身份', replay: '完整回放' }[modal]} close={() => setModal(null)}>
      {modal === 'settings' && <div className="ww-form"><label><input type="checkbox" checked={reduced} onChange={event => setReduced(event.target.checked)} />减少动效</label><label><input type="checkbox" checked={largeText} onChange={event => setLargeText(event.target.checked)} />放大记录文字</label><p>所有玩家使用固定或随机操作，不接入模型，不进行语音发言。打开面板时暂停自动推进。</p></div>}
      {modal === 'restart' && <div className="ww-form"><p>当前演示将被替换。新局从第1夜开始，所有角色重新分配。</p><label>对局种子<input type="number" min="0" max="4294967295" value={seed} onChange={event => setSeed(Number(event.target.value))} /></label><label>行动方式<select value={strategy} onChange={event => setStrategy(event.target.value as 'fixed' | 'random')}><option value="random">随机操作</option><option value="fixed">固定操作</option></select></label><button disabled={busy || !Number.isSafeInteger(seed) || seed < 0 || seed > 4294967295} onClick={() => { setModal(null); setSelected(5); void advance(true, true); }}>确认重开</button><button onClick={() => setModal(null)}>取消</button></div>}
      {modal === 'player' && <div className="ww-player-info"><div className="ww-profile" style={portraitStyle(selected)} /><h3>{selectedPlayer.alive ? '存活' : '已公开出局'}{game.sheriff === selected ? ' · 警长' : ''}</h3><p>身份：{selectedRole ? roleNames[selectedRole] : selectedPlayer.revealedRole ? '白痴（已翻牌）' : '尚未公开'}</p><p>{selectedPlayer.revealedRole ? '保留发言权，没有放逐投票权。' : '仅展示已公开的游戏信息。'}</p></div>}
      {modal === 'votes' && (!vote ? <p>{isPreview ? '当前为布局预览。开始演示后，已完成的放逐投票会在此展示真实票型。' : '尚无已结算的放逐投票。'}</p> : <VoteDetails event={vote} />)}
      {modal === 'roles' && <div className="ww-roles">{game.roles?.map(player => <p key={player.seat}><b>{player.seat}号</b><span>{roleNames[player.role]}</span></p>)}</div>}
      {modal === 'replay' && <div className="ww-replay"><label>日夜记录<select value={replayIndex} onChange={event => setReplayIndex(Number(event.target.value))}>{game.replay?.map((frame, index) => <option key={index} value={index}>第{frame.day}{frame.period === 'night' ? '夜' : '天'} · 记录{index + 1}</option>)}</select></label>{game.replay?.[replayIndex]?.events.map((event, index) => <div key={index}><h3>{describe(event)}</h3>{['wolf-choices', 'medicine', 'inspection'].includes(event.type) && <ReplayDetails event={event} />}{event.type === 'exile-votes' && <VoteDetails event={event} />}</div>)}</div>}
    </Dialog>}
  </main></div>;
}
function VoteDetails({ event }: { event: Event }) {
  const data = event.data as { ballots: { seat: number; target: number | null; kind: string }[]; totals: { seat: number; votes: number }[]; winner: number | null; tied: number[] };
  return <><p>{data.winner ? `${data.winner}号 得票最高` : data.tied.length ? `${data.tied.join('、')}号 平票，进入PK` : '无人被放逐'}</p><table><thead><tr><th>席位</th><th>投给</th></tr></thead><tbody>{data.ballots.map(ballot => <tr key={ballot.seat}><td>{ballot.seat}号</td><td>{ballot.kind === 'missing' ? '未举牌' : ballot.target === null ? '弃票' : `${ballot.target}号`}</td></tr>)}</tbody></table><p>加权票数（警长1.5票）</p><div className="ww-totals">{data.totals.map(total => <span key={total.seat}>{total.seat}号：{total.votes}票</span>)}</div></>;
}
function ReplayDetails({ event }: { event: Event }) {
  if (event.type === 'wolf-choices') return <p>{(event.data as { seat: number; target: number | null }[]).map(item => `${item.seat}号 → ${item.target === null ? '空刀' : `${item.target}号`}`).join('；')}</p>;
  if (event.type === 'inspection') { const data = event.data as { target: number; alignment: string }; return <p>{data.target}号：{data.alignment === 'wolf' ? '狼人' : '好人'}</p>; }
  const data = event.data as { seat: number; action: { kind: string; target?: number } };
  return <p>{data.seat}号：{data.action.kind === 'save' ? '使用解药' : data.action.kind === 'poison' ? `毒 ${data.action.target}号` : '不使用药物'}</p>;
}
