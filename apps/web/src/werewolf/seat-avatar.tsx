import type { CSSProperties } from 'react';
import type { DeathDisplay } from './seat-state.ts';
import './seat-avatar.css';

export const deathNames: Record<DeathDisplay, string> = { night: '夜亡', exile: '放逐', shot: '枪杀', explode: '自爆', knife: '狼刀', poison: '毒杀' };
export function portraitStyle(seat: number): CSSProperties {
  const portraits = [
    { name: 'brown', size: '370% 500%', position: '49% 17%' },
    { name: 'pink', size: '315% 410%', position: '49% 27%' },
    { name: 'blue', size: '370% 500%', position: '48% 23%' },
  ];
  const portrait = portraits[(seat - 1) % portraits.length];
  return { backgroundImage: `url('/werewolf/user-avatar-${portrait.name}.png')`, backgroundSize: portrait.size, backgroundPosition: portrait.position };
}
function Skull() {
  return <><path d="M50 12C27 10 15 25 17 44c0 14 9 20 16 22v15l10 3 7-7 7 7 10-3V66c9-3 16-12 16-23C85 25 72 11 50 12Z"/><ellipse cx="35" cy="42" rx="10" ry="12" fill="#331824"/><ellipse cx="65" cy="42" rx="10" ry="12" fill="#331824"/><path d="m50 55-6 11h12Z" fill="#331824"/><path d="M42 70v10m16-10v10" fill="none"/></>;
}
function DeathIcon({ kind }: { kind: DeathDisplay }) {
  return <svg viewBox="0 0 100 100" aria-hidden="true" fill="currentColor" stroke="#351a23" strokeWidth="3" strokeLinejoin="round">
    {kind === 'night' && <Skull />}
    {kind === 'poison' && <><path d="M39 10h22v9h-4v16c0 7 26 12 26 34 0 26-66 26-66 0 0-22 26-27 26-34V19h-4Z"/><g transform="translate(26 38) scale(.48)" fill="#321338" stroke="none"><Skull /></g><path d="M41 25h18" fill="none"/></>}
    {kind === 'exile' && <><path d="m17 13 10-4 9 14 6-9 11 7-9 28-9 12 14 21-18 9L14 57 9 36Zm66 0-10-4-9 14-6-9-11 7 9 28 9 12-14 21 18 9 17-34 5-21Z"/><path d="m16 48 68 12m-64 0 60-12m-48 22 33-17" fill="none" stroke="#351a23" strokeWidth="5"/></>}
    {kind === 'shot' && <><circle cx="50" cy="50" r="28" fill="none" stroke="currentColor" strokeWidth="7"/><path d="M50 7v86M7 50h86" fill="none" stroke="currentColor" strokeWidth="5"/><path d="m15 18 12-6 58 60-8 14-23-22-10 6-12-13 9-10Z" fill="#f5dfd1"/></>}
    {kind === 'knife' && <><path d="m22 91 9-29L70 17l18 15-46 48Z"/><path d="m67 18 9-12 18 15-8 14Z" fill="#d0ad89"/><path d="m29 66 12 9 22-35" fill="none" stroke="#e93846" strokeWidth="5"/></>}
    {kind === 'explode' && <><path d="m50 5 10 25 23-19-7 29 20 9-24 11 15 29-28-14-11 22-9-26-28 14 15-26-23-9 25-12L14 14l26 17Z"/><path d="m35 32 12 9 16-7-2 17 13 10-17 10-17-5-7-20Z" fill="#3f1421"/></>}
  </svg>;
}
export interface SeatAvatarProps {
  seat: number;
  death?: DeathDisplay | null;
  sheriff?: boolean;
  self?: boolean;
  identity?: string;
  nominated?: boolean;
  mark?: string;
  selected?: boolean;
  viewpoint?: boolean;
  active?: boolean;
  gallery?: boolean;
  onClick?: () => void;
}
export function SeatAvatar(props: SeatAvatarProps) {
  const { seat, death, sheriff, self, identity, nominated, mark, selected, active, gallery, onClick } = props;
  const markTone = mark && ['好人', '金水'].includes(mark) ? 'mark-good' : mark && ['狼', '狼人', '查杀'].includes(mark) ? 'mark-wolf' : 'mark-neutral';
  const description = `${seat}号玩家，${death ? deathNames[death] : '存活'}${self ? '，我' : ''}${identity ? `，${identity}` : ''}${sheriff ? '，警长' : ''}${mark ? `，个人标记${mark}` : ''}`;
  return <button type="button" className={`ww-seat ${gallery ? 'in-gallery' : ''} ${death ? 'dead' : ''} ${selected ? 'selected' : ''} ${active ? 'active' : ''}`} style={{ '--row': (seat - 1) % 6, '--side': seat <= 6 ? 0 : 1 } as CSSProperties} aria-label={description} onClick={onClick}>
    <span className="ww-avatar" style={portraitStyle(seat)} />
    {death && <span className={`ww-death ${death}`}><DeathIcon kind={death}/><span>{deathNames[death]}</span></span>}
    {sheriff && <span className="ww-corner top-left sheriff" title="警长">♛</span>}
    {nominated ? <span className="ww-corner top-right nomination" title="已公布上警">✋</span> : mark && <span className={`ww-corner top-right personal ${markTone}`} title={`个人标记：${mark}`}>{mark}</span>}
    {props.viewpoint && <span className="ww-corner bottom-left self" title="当前观察视角">视角</span>}
    {self && <span className="ww-corner bottom-left self">我</span>}
    {identity && <span className={`ww-corner bottom-right identity ${identity === '狼' || identity === '狼人' ? 'wolf' : identity === '好' ? 'good' : ''}`}>{identity}</span>}
    <span className="ww-seat-number">{seat}</span>
  </button>;
}
const examples: (SeatAvatarProps & { caption: string })[] = [
  { seat: 1, caption: '存活 · 公共' }, { seat: 2, death: 'exile', caption: '放逐 · 公共' },
  { seat: 3, death: 'night', caption: '夜亡 · 公共' }, { seat: 4, death: 'shot', caption: '枪杀 · 公共' },
  { seat: 5, death: 'knife', caption: '狼刀 · 狼人视角' }, { seat: 6, death: 'poison', caption: '毒杀 · 女巫视角' },
  { seat: 7, death: 'explode', caption: '自爆 · 公共' }, { seat: 8, sheriff: true, caption: '警长 · 公共' },
  { seat: 9, self: true, identity: '女巫', caption: '本人身份 · 本人' }, { seat: 10, identity: '狼', caption: '狼队友 · 狼人视角' },
  { seat: 11, identity: '好', caption: '查验好人 · 预言家' }, { seat: 12, identity: '狼', caption: '查验狼人 · 预言家' },
  { seat: 1, nominated: true, caption: '上警 · 已公布' }, { seat: 2, mark: '狼人', caption: '手标 · 仅自己' },
  { seat: 3, mark: '金水', caption: '手标 · 仅自己' }, { seat: 4, identity: '白痴', caption: '翻牌 · 公共' },
];
export function AvatarExamples() {
  return <><p>分视角样例，不代表当前对局身份。</p><div className="ww-avatar-examples">{examples.map((example, index) => <div key={index}><small>{example.caption}</small><SeatAvatar {...example} gallery /></div>)}</div></>;
}
