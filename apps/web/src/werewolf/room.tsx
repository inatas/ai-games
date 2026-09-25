import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { DemoSnapshot } from '../../../shared/werewolf.ts';
import { SeatAvatar, AvatarExamples, portraitStyle, deathNames } from './seat-avatar.tsx';
import { publicSeatState } from './seat-state.ts';
import { HistoryIcon, SpeechHistory } from './speech-history.tsx';
import { SpeakerAvatar, LiveTransition, VoteSummary, SpeechBubble } from './live-scene.tsx';
import { boardEvents } from './presentation.ts';
import './room.css';
import { RobotLobby } from './robot-lobby.tsx';
import { RobotUsersContext } from './robot-context.tsx';
import { ModelDiagnostics } from './model-diagnostics.tsx';

type Event = DemoSnapshot['events'][number];
type Modal = 'perspective' | 'knowledge' | 'history' | 'samples' | 'settings' | 'restart' | 'player' | 'roles' | 'diagnostics' | null;
const roleNames: Record<string, string> = { wolf: '狼人', villager: '村民', seer: '预言家', witch: '女巫', hunter: '猎人', idiot: '白痴' };
const preview: DemoSnapshot = {
  id: 'preview', revision: 0, status: 'running', day: 2, period: 'day', phaseLabel: '放逐投票', actor: 5,
  speakerSeat: null, nightSegment: null, timing: { remainingMs: 0 }, speeches: [],
  progress: { submitted: 5, eligible: 9 }, sheriff: 1,
  players: Array.from({ length: 12 }, (_, i) => ({ seat: i + 1, alive: ![3, 8].includes(i + 1), ...(i === 9 ? { revealedRole: 'idiot' as const } : {}) })),
  events: [
    { sequence: 1, day: 1, period: 'day', type: 'sheriff-result', data: { seat: 1 } },
    { sequence: 2, day: 2, period: 'day', type: 'night-deaths', data: { seats: [3, 8] } },
    { sequence: 3, day: 2, period: 'day', type: 'speech', data: { seat: 5, text: '' } },
  ], result: null,
};

async function request(path: string, mode: 'demo' | 'model' = 'demo', body?: object): Promise<DemoSnapshot> {
  const response = await fetch(`/api/werewolf/${mode}${path}`, body ? {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  } : undefined);
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { error?: string } | null;
    throw Object.assign(new Error(error?.error ?? '连接中断，请重试'), { status: response.status });
  }
  return response.json() as Promise<DemoSnapshot>;
}
function describe(event: Event): string {
  const data = event.data as { seat?: number | null; seats?: number[]; target?: number | null; winner?: string; direction?: string; text?: string };
  const seats = data.seats?.map(seat => `${seat}号`).join('、');
  switch (event.type) {
    case 'sheriff-result': return data.seat ? `${data.seat}号 当选警长` : '警徽流失 · 本局无警长';
    case 'night-deaths': return data.seats?.length ? `昨夜 ${seats} 出局` : '昨夜平安夜，无人出局';
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
    case 'wolf-knife': return '狼人刀口结算';
    default: return '公开结算记录';
  }
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
  const [roomMode, setRoomMode] = useState<'demo' | 'model'>('demo');
  const [selected, setSelected] = useState(5);
  const [viewer, setViewer] = useState<number | null>(null);
  const viewEpoch = useRef(0);
  function switchViewer(seat: number | null) {
    if (seat === viewer) { setModal(null); return; }
    viewEpoch.current++;
    setViewer(seat);
    setGame(current => ({ ...current, perspective: { kind: 'public' } }));
    setModal(null);
  }
  const knowledge = game.perspective?.kind === 'seat' && game.perspective.seat === viewer ? game.perspective : null;
  const [modal, setModal] = useState<Modal>(null);
  const [expanded, setExpanded] = useState(true);
  const [reduced, setReduced] = useState(false);
  const [largeText, setLargeText] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showLobby, setShowLobby] = useState(false);
  const [activeSeed, setActiveSeed] = useState(42);
  const [atLatest, setAtLatest] = useState(true);
  const [marks, setMarks] = useState<Record<string, Record<number, string>>>(() => {
    try { return JSON.parse(sessionStorage.getItem('werewolf:marks:v2') ?? '{}'); } catch { return {}; }
  });
  function setMark(value: string) {
    const next = { ...marks, [game.id]: { ...marks[game.id], [selected]: value } };
    setMarks(next);
    try { sessionStorage.setItem('werewolf:marks:v2', JSON.stringify(next)); }
    catch { setError('标记仅在当前页面保留'); }
  }
  const log = useRef<HTMLDivElement>(null);
  const isPreview = game.id === 'preview';
  const ended = game.status === 'finished';
  const night = game.period === 'night';
  const selectedPlayer = game.players.find(player => player.seat === selected)!;
  const selectedRole = knowledge?.seat === selected ? knowledge.role : game.roles?.find(player => player.seat === selected)?.role;
  const result = game.events.findLast(event => event.type === 'game-result');
  const events = boardEvents(game.events);

  useEffect(() => {
    let cancelled = false;
    const saved = sessionStorage.getItem('werewolf:active-room');
    if (!saved) return;
    try {
      const active = JSON.parse(saved) as { id: string; seed: number; mode?: 'demo' | 'model' };
      setBusy(true);
      void request(`/${active.id}`, active.mode ?? 'demo').then(next => {
        if (!cancelled) { setGame(next); setActiveSeed(next.seed ?? active.seed); setRoomMode(active.mode ?? 'demo'); }
      }).catch(() => { sessionStorage.removeItem('werewolf:active-room'); })
        .finally(() => { if (!cancelled) setBusy(false); });
    } catch { sessionStorage.removeItem('werewolf:active-room'); }
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (isPreview) return;
    let stopped = false;
    const epoch = viewEpoch.current;
    let timer: number;
    async function poll() {
      try {
        const next = await request(`/${game.id}${viewer === null ? '' : `?seat=${viewer}`}`, roomMode);
        if (!stopped && epoch === viewEpoch.current) { setGame(next); setError(''); }
      } catch (cause) {
        if (!stopped && epoch === viewEpoch.current) {
          if ((cause as { status?: number }).status === 404) {
            viewEpoch.current++; setViewer(null); setGame(preview); setModal(null);
            sessionStorage.removeItem('werewolf:active-room');
          }
          setError(cause instanceof Error ? cause.message : '连接中断，正在重新连接');
        }
      } finally {
        if (!stopped) timer = window.setTimeout(() => void poll(), 250);
      }
    }
    timer = window.setTimeout(() => void poll(), 250);
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [game.id, game.status, viewer, roomMode]);
  useEffect(() => {
    if (!isPreview && atLatest && log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [game.events.length, expanded]);
  const status = error || (ended ? '对局结束 · 身份已揭晓' : isPreview ? '观战预览 · 点击开始对局' : game.status !== 'running' ? '对局异常停止，请重开' : night ? '天黑请闭眼 · 夜间行动' : game.actor ? `${game.actor}号 · ${game.phaseLabel}` : game.phaseLabel);

  if (showLobby || isPreview) return busy ? <p>正在恢复对局…</p> : <RobotLobby
    started={(next, seed, mode) => {
      viewEpoch.current++; setViewer(null); setGame(next); setActiveSeed(seed); setRoomMode(mode);
      setModal(null); setShowLobby(false); setError('');
    }}
    close={isPreview ? undefined : () => setShowLobby(false)} />;

  return <RobotUsersContext.Provider value={game.players}><div className="ww-page"><main className={`ww-stage ${viewer !== null ? 'has-perspective' : ''} ${night ? 'is-night' : ''} ${reduced ? 'reduced-motion' : ''} ${largeText ? 'large-text' : ''}`} aria-label="狼人杀旁观房间">
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
        {events.map(event => <div className="ww-card" key={event.sequence}>{event.type === 'exile-votes' || event.type === 'sheriff-votes' ? <VoteSummary event={event}/> : describe(event)}</div>)}
        {!ended && <div className="ww-card ww-progress">{game.phaseLabel}{night ? '中' : '进行中'}{game.progress && <strong>已提交 {game.progress.submitted} / {game.progress.eligible}</strong>}</div>}
        {isPreview && <><div className="ww-divider">公开记录</div><div className="ww-card ww-preview-vote">第1天投票结果</div></>}
      </div>
      {!atLatest && expanded && <button className="ww-latest" onClick={() => { log.current!.scrollTop = log.current!.scrollHeight; setAtLatest(true); }}>回到最新 ↓</button>}
    </section>
    <button className="ww-record-toggle" onClick={() => setExpanded(value => !value)} aria-expanded={expanded}><span>{expanded ? '⋀' : '⋁'}</span>公开记录<span>{expanded ? '⋀' : '⋁'}</span></button>
    <div className={`ww-status ${error ? 'has-error' : ''}`} role="status">{status}{!isPreview && game.status === 'running' && !error && <span className="ww-countdown"> · {Math.ceil(game.timing.remainingMs / 1000)}秒</span>}</div>
    {game.players.map(player => {
      const state = publicSeatState(player.seat, player.alive, game.events, game.phaseLabel === '警长竞选');
      const seen = knowledge?.inspections?.findLast(item => item.target === player.seat);
      const privateIdentity = knowledge?.seat === player.seat ? roleNames[knowledge.role] : knowledge?.wolves?.includes(player.seat) ? '狼' : seen ? (seen.alignment === 'wolf' ? '狼' : '好') : undefined;
      const identity = ended ? roleNames[game.roles?.find(item => item.seat === player.seat)?.role ?? '']
        : privateIdentity ?? (player.revealedRole ? '白痴' : state.death === 'explode' ? '狼' : undefined);
      return <SeatAvatar key={player.seat} seat={player.seat}
        death={knowledge?.deaths.find(item => item.seat === player.seat)?.cause ?? state.death} viewpoint={viewer === player.seat}
        sheriff={game.sheriff === player.seat}
        identity={identity} nominated={state.nominated}
        mark={marks[game.id]?.[player.seat]}
        selected={selected === player.seat} active={game.speakerSeat === player.seat}
        onClick={() => { setSelected(player.seat); setModal('player'); }} />;
    })}
    <SpeakerAvatar seat={game.speakerSeat}/><SpeechBubble game={game}/>
    {night && !ended && <div className="ww-night-notice"><strong>{game.nightSegment === 'medicine' ? '女巫行动中' : '狼人、预言家行动中'}</strong><span>夜间行动结束后公布公开结果</span></div>}
        <button className="ww-observer" disabled={isPreview} title={isPreview ? '开始对局后可切换视角' : undefined} onClick={() => setModal('perspective')}>◉ {viewer === null ? '公共旁观' : `${viewer}号视角`} ▾</button>
    {viewer !== null && <button className="ww-view-knowledge" onClick={() => setModal('knowledge')}><span style={portraitStyle(viewer, game.players.find(player => player.seat === viewer)?.user)}/><b>{viewer}号 · {knowledge ? roleNames[knowledge.role] : '加载中'}</b><small>已知信息 ▸</small></button>}
    <button className="ww-history-entry" aria-label="查看对局历史" onClick={() => setModal('history')}><HistoryIcon/>历史</button>
    <nav className="ww-controls" aria-label="演示控制">
      {ended ? <button onClick={() => setModal('roles')}>查看身份</button> : isPreview ? <button className="ww-autoplay" onClick={() => setShowLobby(true)} disabled={busy}>开始对局</button> : <span className="ww-playback-label">对局进行中 · 实时旁观</span>}
      <button className="ww-restart" onClick={() => setModal('restart')}>⟳ {ended ? '再来一局' : '重开'}</button>
      {roomMode === 'model' && <button onClick={() => setModal('diagnostics')}>模型诊断</button>}
    </nav>
    <p className="ww-caption">{isPreview ? '原型示意 · 点击开始对局' : ended
      ? `${roomMode === 'model' ? '模型Robot对局' : '脚本Robot对局'} · 终局公开`
      : `${roomMode === 'model' ? '模型与脚本Robot' : '脚本Robot · 固定短句发言'} · 查看历史不停表`}</p>
    <LiveTransition game={game} suppressed={modal !== null}/>
    {modal === 'history' && <SpeechHistory key={game.id} game={game} close={() => setModal(null)} />}
    {modal && modal !== 'history' && <Dialog title={{ perspective: '选择观察视角', knowledge: '当前视角 · 已知信息', samples: '头像状态 · v2.1', settings: '显示设置', restart: '开启新对局', player: `${selected}号玩家`, roles: '终局身份', diagnostics: '模型调用诊断' }[modal]} close={() => setModal(null)}>
      {modal === 'diagnostics' && <ModelDiagnostics roomId={game.id} />}
      {modal === 'perspective' && <><p>仅切换观察视角，玩家继续自动行动。此入口用于本地调试。</p><button aria-pressed={viewer === null} onClick={() => switchViewer(null)}>公共旁观</button><div className="ww-view-grid">{game.players.map(player => <button key={player.seat} aria-label={`观察${player.seat}号`} aria-pressed={viewer === player.seat} onClick={() => switchViewer(player.seat)}><span style={portraitStyle(player.seat, player.user)}/>{player.seat}号</button>)}</div></>}
      {modal === 'knowledge' && (!knowledge ? <p>正在加载当前视角信息…</p> : <div className="ww-knowledge"><h3>{knowledge.seat}号 · {roleNames[knowledge.role]}</h3>{knowledge.wolves && <p>狼队友：{knowledge.wolves.filter(seat => seat !== viewer).join('、')}号</p>}{knowledge.knives?.map(item => <p key={item.night}>第{item.night}夜狼刀：{item.target === null ? '空刀' : `${item.target}号`}</p>)}{knowledge.inspections && <><h3>已查验</h3>{knowledge.inspections.length ? knowledge.inspections.map(item => <p key={item.night}>第{item.night}夜 · {item.target}号：{item.alignment === 'wolf' ? '狼' : '好'}</p>) : <p>尚无查验结果</p>}</>}{knowledge.medicine && <><p>解药：{knowledge.medicine.antidote ? '剩余1瓶' : '已用'} · 毒药：{knowledge.medicine.poison ? '剩余1瓶' : '已用'}</p><p>授权刀口：{'knife' in knowledge ? knowledge.knife === null ? '空刀' : `${knowledge.knife}号` : '当前不可见'}</p></>}{knowledge.deaths.map(item => <p key={item.seat}>{item.seat}号：{item.cause === 'poison' ? '毒杀' : '狼刀'}出局</p>)}<p>只显示该席位有权知道的信息。</p></div>)}
      {modal === 'samples' && <AvatarExamples />}
      {modal === 'settings' && <div className="ww-form"><label><input type="checkbox" checked={reduced} onChange={event => setReduced(event.target.checked)} />减少动效</label><label><input type="checkbox" checked={largeText} onChange={event => setLargeText(event.target.checked)} />放大记录文字</label><p>{roomMode === 'model' ? '模型与脚本Robot共同参与，不进行语音发言。' : '所有玩家使用固定或随机操作，不进行语音发言。'}查看面板期间游戏与倒计时持续运行。</p><button onClick={() => setModal('samples')}>头像状态预览</button></div>}
      {modal === 'restart' && <div className="ww-form"><p>返回座位管理，配置下一局阵容后手动开始。当前对局继续运行。</p><button onClick={() => { setModal(null); setShowLobby(true); }}>进入座位管理</button><button onClick={() => setModal(null)}>取消</button></div>}
      {modal === 'player' && <div className="ww-player-info"><div className="ww-profile" style={portraitStyle(selected, selectedPlayer.user)} /><h3>{selectedPlayer.user?.nickname ?? `${selected}号玩家`}</h3>{selectedPlayer.user && <p>用户ID：{selectedPlayer.user.userId}</p>}<h3>{selectedPlayer.alive ? '存活' : deathNames[publicSeatState(selected, false, game.events, false).death ?? 'night']}{game.sheriff === selected ? ' · 警长' : ''}</h3><p>身份：{selectedRole ? roleNames[selectedRole] : selectedPlayer.revealedRole ? '白痴（已翻牌）' : '尚未公开'}</p><p>{selectedPlayer.revealedRole ? '保留发言权，没有放逐投票权。' : '仅展示当前视角可见的游戏信息。'}</p>{<><h3>个人标记</h3><p>仅自己可见，不代表真实身份。</p><div className="ww-mark-options">{['狼人', '好人', '金水', '查杀', '可疑', ''].map(value => <button key={value} aria-pressed={(marks[game.id]?.[selected] ?? '') === value} onClick={() => setMark(value)}>{value || '清除'}</button>)}</div></>}</div>}
      {modal === 'roles' && <div className="ww-roles">{game.roles?.map(player => <p key={player.seat}><b>{player.seat}号</b><span>{roleNames[player.role]}</span></p>)}</div>}
    </Dialog>}
  </main></div></RobotUsersContext.Provider>;
}
