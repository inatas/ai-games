import type { RobotPublicUser } from '@game-ai/core';
import { useRobotUser } from './robot-context.tsx';
import type { CSSProperties } from 'react';
import type { DeathDisplay } from './seat-state.ts';
import { SheriffIcon } from './sheriff-icon.tsx';
import './seat-avatar.css';

export const deathNames: Record<DeathDisplay, string> = { night: '夜亡', exile: '放逐', shot: '枪杀', explode: '自爆', knife: '狼刀', poison: '毒杀' };
export function portraitStyle(seat: number, user?: RobotPublicUser): CSSProperties {
  if (user) return { backgroundImage: `url("${user.avatar.src}")`, backgroundSize: user.avatar.size, backgroundPosition: user.avatar.position };
  const portraits = [
    { name: 'brown', size: '370% 500%', position: '49% 17%' },
    { name: 'pink', size: '315% 410%', position: '49% 27%' },
    { name: 'blue', size: '370% 500%', position: '48% 23%' },
  ];
  const portrait = portraits[(seat - 1) % portraits.length];
  return { backgroundImage: `url('/werewolf/user-avatar-${portrait.name}.png')`, backgroundSize: portrait.size, backgroundPosition: portrait.position };
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
  const user = useRobotUser(props.seat);
  const { seat, death, sheriff, self, identity, nominated, mark, selected, active, gallery, onClick } = props;
  const markTone = mark && ['好人', '金水'].includes(mark) ? 'mark-good' : mark && ['狼', '狼人', '查杀'].includes(mark) ? 'mark-wolf' : 'mark-neutral';
  const description = `${seat}号玩家，${death ? deathNames[death] : '存活'}${self ? '，我' : ''}${identity ? `，${identity}` : ''}${sheriff ? '，警长' : ''}${mark ? `，个人标记${mark}` : ''}`;
  return <button type="button" className={`ww-seat ${gallery ? 'in-gallery' : ''} ${death ? 'dead' : ''} ${selected ? 'selected' : ''} ${active ? 'active' : ''}`} style={{ '--row': (seat - 1) % 6, '--side': seat <= 6 ? 0 : 1 } as CSSProperties} aria-label={user ? `${user.nickname}，${description}` : description} onClick={onClick}>
    <span className="ww-avatar" style={portraitStyle(seat, user)} />
    {death && <span className="ww-death" aria-hidden="true"><img src={`/werewolf/death/${death}.png`} alt="" draggable={false}/></span>}
    {sheriff && <span className="ww-corner top-left sheriff" title="警长"><SheriffIcon/></span>}
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
