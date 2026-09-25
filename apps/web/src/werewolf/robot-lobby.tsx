import { useEffect, useRef, useState } from 'react';
import type { DemoSnapshot } from '../../../shared/werewolf.ts';
import { fillRobotSeats, type RobotCatalogEntry } from '../../../shared/robot-seating.ts';
import { portraitStyle } from './seat-avatar.tsx';
import './robot-lobby.css';

type Draft = { seats: (string | null)[]; profileIds: (string | null)[]; seed: number };
type Profile = { id: string; label: string; model: string };
function savedDraft(): Draft {
  try {
    const draft = JSON.parse(sessionStorage.getItem('werewolf:robot-draft') ?? 'null');
    if (draft && Array.isArray(draft.seats) && draft.seats.length === 12 && draft.seats.every((id: unknown) => id === null || typeof id === 'string') && Number.isSafeInteger(draft.seed))
      return { ...draft, profileIds: Array.isArray(draft.profileIds) && draft.profileIds.length === 12 ? draft.profileIds : Array(12).fill(null) };
  } catch { /* Missing or invalid draft starts empty. */ }
  return { seats: Array(12).fill(null), profileIds: Array(12).fill(null), seed: 42 };
}
export function RobotLobby({ started, close }: { started: (game: DemoSnapshot, seed: number, mode: 'demo' | 'model') => void; close?: () => void }) {
  const [draft, setDraft] = useState(savedDraft);
  const [users, setUsers] = useState<RobotCatalogEntry[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [restoreId, setRestoreId] = useState('');
  const inFlight = useRef(false);
  useEffect(() => {
    let stopped = false;
    void fetch('/api/robot-users').then(async response => {
      if (!response.ok) throw new Error('Robot目录加载失败，请刷新重试');
      return response.json() as Promise<RobotCatalogEntry[]>;
    }).then(catalog => {
      if (stopped) return;
      setUsers(catalog);
      setDraft(current => {
        const used = new Set<string>();
        return { ...current, seats: current.seats.map(id => {
          if (!id || used.has(id) || !catalog.some(user => user.userId === id && user.available)) return null;
          used.add(id); return id;
        }) };
      });
    }).catch(cause => { if (!stopped) setError(String(cause.message)); })
      .finally(() => { if (!stopped) setLoading(false); });
    return () => { stopped = true; };
  }, []);
  useEffect(() => {
    let stopped = false;
    void fetch('/api/werewolf/model/profiles').then(async response => {
      if (!response.ok) return [] as Profile[];
      return response.json() as Promise<Profile[]>;
    }).then(found => { if (!stopped) setProfiles(found); })
      .catch(() => { if (!stopped) setError('模型列表加载失败，请刷新重试'); });
    return () => { stopped = true; };
  }, []);
  useEffect(() => { try { sessionStorage.setItem('werewolf:robot-draft',JSON.stringify(draft)); } catch { setError('无法保存草稿，刷新后可能丢失配置'); } }, [draft]);
  function assign(id: string | null) {
    if (selected === null || busy || (id !== null && !users.some(user => user.userId === id && user.available))) return;
    const user = users.find(item => item.userId === id);
    setDraft(current => ({ ...current,
      seats: current.seats.map((old,index) => index === selected ? id : old),
      profileIds: current.profileIds.map((old,index) => index === selected ? user?.defaultProfileId ?? null : old),
    }));
    setSelected(null); setError('');
  }
  async function restore() {
    setError('');
    try {
      const response = await fetch(`/api/werewolf/model/${encodeURIComponent(restoreId.trim())}`);
      if (!response.ok) throw new Error('未找到该持久模型房间');
      const room = await response.json() as DemoSnapshot;
      sessionStorage.setItem('werewolf:active-room', JSON.stringify({ id: room.id, seed: room.seed ?? draft.seed, mode: 'model' }));
      started(room, room.seed ?? draft.seed, 'model');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '恢复失败'); }
  }
  async function start() {
    if (inFlight.current || draft.seats.some(id => !id)) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const profileIds = draft.seats.map((id, index) => {
        const user = users.find(item => item.userId === id);
        return user?.controller === 'model' ? draft.profileIds[index] ?? user.defaultProfileId ?? null : null;
      });
      const mode = draft.seats.some(id => users.find(user => user.userId === id)?.controller === 'model') ? 'model' : 'demo';
      if (mode === 'model' && profileIds.some(id => id !== null && !profiles.some(profile => profile.id === id)))
        throw new Error('当前座位选择的模型不可用，请刷新模型列表');
      const signature = JSON.stringify({ ...draft, profileIds });
      let attempt: {signature:string;id:string} | null = null;
      try { attempt = JSON.parse(sessionStorage.getItem('werewolf:robot-start') ?? 'null'); } catch { /* Invalid attempt is replaced. */ }
      if (attempt?.signature !== signature) attempt = {signature,id:crypto.randomUUID()};
      sessionStorage.setItem('werewolf:robot-start',JSON.stringify(attempt));
      const response = await fetch(`/api/werewolf/${mode}/start`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:attempt!.id,seed:draft.seed,userIds:draft.seats,
          ...(mode === 'model' ? { profileIds } : {})})});
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 404) sessionStorage.removeItem('werewolf:robot-start');
        throw new Error(result.error ?? '无法开始游戏');
      }
      sessionStorage.setItem('werewolf:active-room',JSON.stringify({id:result.id,seed:draft.seed,mode}));
      sessionStorage.removeItem('werewolf:robot-start');
      started(result,draft.seed,mode);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '开局失败，请重试'); }
    finally { inFlight.current=false; setBusy(false); }
  }
  const count = draft.seats.filter(Boolean).length;
  return <main className="robot-lobby">
    <header><small>十二人预女猎白 · Robot工具</small><h1>座位管理</h1><p>选择Robot用户入座，准备好后手动开始游戏。</p></header>
    <div className="robot-lobby-toolbar"><b>已入座 {count} / 12</b><button disabled={busy || loading || !users.length || count === 12} onClick={() => {setDraft(current => ({...current,seats:fillRobotSeats(current.seats,users)}));setSelected(null);}}>随机补满</button>{close && <button disabled={busy} onClick={close}>返回当前对局</button>}</div>
    <section className="robot-test-connect"><small>{profiles.length ? `${profiles.length} 个可用模型` : '当前没有可用模型；模型凭据由本机后端配置。'}</small></section>
    <section className="robot-test-restore"><label>恢复房间 ID <input value={restoreId} onChange={event => setRestoreId(event.target.value)} placeholder="粘贴房间 ID" /></label>
      <button type="button" disabled={!restoreId.trim()} onClick={() => void restore()}>查看已有对局</button></section>
    {loading && <p role="status">加载Robot用户…</p>}
    <div className="robot-seat-grid">{draft.seats.map((id,index) => {
      const user = users.find(item => item.userId === id);
      return <div className="robot-seat-config" key={index}><button className={user ? 'occupied' : 'empty'} disabled={busy || loading || !users.length} onClick={() => setSelected(index)} aria-label={`${index+1}号座位，${user?.nickname ?? '空位'}`} aria-pressed={selected === index}>
        <b>{index+1}号位</b>{user ? <><span className="robot-face" style={portraitStyle(index+1,user)}/><strong>{user.nickname}</strong><small>Robot · {user.gender === 'female' ? '女' : user.gender === 'male' ? '男' : '未设置'}</small></> : <><span className="robot-seat-plus">＋</span><strong>选择Robot</strong><small>空座位</small></>}
      </button>{user?.controller === 'model' && profiles.length > 0 && <select aria-label={`${index+1}号模型 profile`}
        value={draft.profileIds[index] ?? user.defaultProfileId ?? ''} onChange={event => setDraft(current => ({ ...current,
          profileIds: current.profileIds.map((old, seat) => seat === index ? event.target.value : old) }))}>
        {profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.label} · {profile.model}</option>)}
      </select>}</div>;
    })}</div>
    {selected !== null && <section className="robot-picker" aria-label="Robot用户列表"><header><h2>{selected+1}号位 · {draft.seats[selected] ? '替换或移除' : '选择Robot用户'}</h2><button onClick={() => setSelected(null)}>收起</button>{draft.seats[selected] && <button disabled={busy} onClick={() => assign(null)}>移除此Robot</button>}</header><div className="robot-user-grid">{users.map(user => {
      const seat = draft.seats.indexOf(user.userId);
      return <button key={user.userId} disabled={busy || !user.available || (seat !== -1 && seat !== selected)} onClick={() => assign(user.userId)}><span className="robot-face" style={portraitStyle(1,user)}/><strong>{user.nickname}</strong><small>{!user.available ? user.unavailableReason : seat !== -1 ? `已在${seat+1}号位` : '可入座'}</small><code title={user.userId}>{user.userId.slice(0,8)}</code></button>;
    })}</div></section>}
    <footer><label>对局种子 <input aria-label="对局种子" type="number" min={0} max={4294967295} disabled={busy} value={draft.seed} onChange={event => setDraft(current => ({...current,seed:Number(event.target.value)}))}/></label><button className="robot-start" disabled={busy || loading || count !== 12 || new Set(draft.seats).size !== 12 || !Number.isSafeInteger(draft.seed) || draft.seed < 0 || draft.seed > 4294967295} onClick={() => void start()}>{busy ? '正在开局…' : '开始游戏'}</button><p>{count === 12 ? '阵容已满，等待点击开始；不会自动开局。' : '请先配置12名不同的Robot用户。'}</p><small>{draft.seats.some(id => users.find(user => user.userId === id)?.controller === 'model') ? '含模型Robot的对局使用持久房间与固定阶段倒计时。' : '默认随机合法行动，发言为固定短句。'}{close ? '当前对局仍在继续，配置工具不会暂停它。' : ''}</small></footer>
    {error && <p className="robot-error" role="alert">{error}</p>}
  </main>;
}
