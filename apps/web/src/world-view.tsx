import React, { useEffect, useId, useRef, useState } from 'react';
import type { WorldView as View, GameAction } from '@game-ai/mud-core';

export type WorldViewData = {
  map: View['map']; scene: View['scene'];
  inventory: { itemId: string; name: string; quantity: number }[];
  quests: { questId: string; name: string; status: string; description: string }[];
};
export function WorldView({ game, disabled, act }: { game: WorldViewData; disabled: boolean; act: (a: GameAction) => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [nodeId, setNodeId] = useState(game.map.currentRoomId);
  const [tab, setTab] = useState('scene');
  useEffect(() => { setSelected(null); setNodeId(game.map.currentRoomId); }, [game.map.currentRoomId]);
  const object = game.scene.objects.find(o => o.id === selected);
  const node = game.map.nodes.find(n => n.roomId === nodeId);
  const exits = game.map.edges.filter(e => e.from === game.map.currentRoomId);
  return <>
    <nav className="world-tabs" aria-label="江湖视图">{[['map','地图'],['scene','场景'],['journal','行囊与任务']].map(([key,label]) => <button key={key} aria-pressed={tab === key} onClick={() => setTab(key)}>{label}</button>)}</nav>
    <div className="world-panels" data-tab={tab}>
      <section className="map-panel" aria-label="房间关系图">
        <div className="panel-heading"><span>{game.map.name}</span><small>已知近邻 · 两步范围</small></div>
        <RoomMap map={game.map} select={setNodeId}/>
        <p className="map-legend">@ 所在地　□ 室内　○ 野外<br/>虚线箭头：单向　浅色：未探索</p>
        {node && <p className="map-selection">{node.name} · {node.isCurrent ? '当前位置' : node.discovery === 'frontier' ? '未探索' : '曾经到访'}{!node.isCurrent && ' · 选择下方出口前往'}</p>}
      </section>
      <section className="scene-panel" aria-label="当前场景">
        <div className="panel-heading"><h2>{game.scene.name}</h2><small>{game.map.name}</small></div>
        <div className={`room-scene scene-${game.scene.templateId}`}>
          <SceneArt kind={game.scene.templateId}/>
          <span className="scene-caption">{game.scene.name}</span>
          {game.scene.objects.map(o => <button key={o.id} className={`scene-object ${selected === o.id ? 'selected' : ''}`} style={{ left: `${o.layout.x}%`, top: `${o.layout.y}%` }} onClick={() => setSelected(o.id)} aria-label={`查看${o.name}`}>
            <span className={`object-glyph ${o.kind}`}>{o.kind === 'npc' ? '人' : o.kind === 'item' ? '物' : '碑'}</span><strong>{o.name}</strong>
          </button>)}
          <span className="traveller" aria-label="你的角色">侠</span>
        </div>
        <p className="room-description">{game.scene.description}</p>
        <div className="object-list" aria-label="此地对象">{game.scene.objects.length ? game.scene.objects.map(o => <button key={o.id} aria-pressed={selected === o.id} onClick={() => setSelected(o.id)}>{o.kind === 'npc' ? '交谈' : '查看'} · {o.name}</button>) : <span>此地无人，沿路继续探索。</span>}</div>
      </section>
      <section className="world-journal" aria-label="行囊与任务"><h3>行囊</h3>{game.inventory.length ? game.inventory.map(i => <p key={i.itemId}>{i.name} × {i.quantity}</p>) : <p>暂无物品。</p>}<h3>任务</h3><div>{game.quests.map(q => <div key={q.questId}><strong>{q.name} · {q.status}</strong><p>{q.description}</p></div>)}</div></section>
    </div>
    <section className="interaction" aria-label="对象交互">
      {object ? <><h3>{object.name}</h3><p>{object.description}</p><div className="interaction-actions">{object.actions.map(a => <button key={a.action} disabled={disabled} onClick={() => act(a)}>{a.label}</button>)}{!object.actions.length && <span>这段缘分已了。</span>}</div></> : <p>点击场景中的人物或物件，查看可做的事。</p>}
    </section>
    <section className="exits" aria-label="当前出口"><h3>从这里出发</h3>{exits.map(e => <div key={e.exitId}><button disabled={disabled || e.access !== 'open'} onClick={() => act({ action: 'move', label: '移动', exitId: e.exitId })}>{e.access === 'locked' ? '锁 · ' : '→ '}{e.direction} · {game.map.nodes.find(n => n.roomId === e.to)?.name}</button>{e.reason && <small>{e.reason}</small>}</div>)}</section>
  </>;
}

function RoomMap({ map, select }: { map: WorldViewData['map']; select: (id: string) => void }) {
  const marker = useId().replaceAll(':', '');
  const current = map.nodes.find(n => n.isCurrent)!;
  const [camera, setCamera] = useState({ x: current.layout.x - 180, y: current.layout.y - 170, width: 360 });
  useEffect(() => { setCamera(c => ({ ...c, x: current.layout.x - c.width/2, y: current.layout.y - c.width/2 })); }, [current.roomId]);
  const drag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);
  const zoom = (factor: number) => setCamera(c => {
    const width = Math.min(900, Math.max(200, c.width * factor));
    return { x: c.x + (c.width - width) / 2, y: c.y + (c.width - width) / 2, width };
  });
  return <><div className="map-tools"><button aria-label="放大地图" onClick={() => zoom(.8)}>＋</button><button aria-label="缩小地图" onClick={() => zoom(1.25)}>－</button><button onClick={() => setCamera({ x: current.layout.x - 180, y: current.layout.y - 170, width: 360 })}>回到当前位置</button></div>
    <svg className="room-map" viewBox={`${camera.x} ${camera.y} ${camera.width} ${camera.width}`} aria-label="可交互局部地图"
      onPointerDown={e => { if ((e.target as Element).closest('[data-node]')) return; e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, cx: camera.x, cy: camera.y }; }}
      onPointerMove={e => { if (!drag.current) return; const scale = camera.width / e.currentTarget.getBoundingClientRect().width; const d = drag.current; setCamera(c => ({ ...c, x: d.cx - (e.clientX - d.x) * scale, y: d.cy - (e.clientY - d.y) * scale })); }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      <defs><marker id={marker} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto-start-reverse"><path d="M0,0 L7,3.5 L0,7" fill="#849180"/></marker></defs>
      {map.edges.map(e => {
        const from = map.nodes.find(n => n.roomId === e.from)!; const to = map.nodes.find(n => n.roomId === e.to)!;
        const dx = to.layout.x - from.layout.x; const dy = to.layout.y - from.layout.y; const length = Math.hypot(dx,dy) || 1;
        const reverse = map.edges.some(other => other.from === e.to && other.to === e.from);
        const offset = reverse ? 4 : 0;
        return <g key={e.exitId}><line x1={from.layout.x + dx/length*24 - dy/length*offset} y1={from.layout.y + dy/length*24 + dx/length*offset} x2={to.layout.x - dx/length*25 - dy/length*offset} y2={to.layout.y - dy/length*25 + dx/length*offset} stroke={e.access === 'locked' ? '#ab7960' : '#849180'} strokeWidth="1.5" strokeDasharray={e.bidirectional ? undefined : '5 5'} markerStart={e.bidirectional && !reverse ? `url(#${marker})` : undefined} markerEnd={`url(#${marker})`}/>{e.access === 'locked' && <text x={(from.layout.x+to.layout.x)/2} y={(from.layout.y+to.layout.y)/2-9} className="map-lock">锁</text>}</g>;
      })}
      {map.nodes.map(n => <g key={n.roomId} data-node="true" role="button" tabIndex={0} aria-label={`${n.name}${n.isCurrent ? '，当前位置' : n.discovery === 'frontier' ? '，未探索' : ''}`} className={`map-node ${n.isCurrent ? 'current' : ''} ${n.discovery}`} onClick={() => select(n.roomId)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(n.roomId); } }} transform={`translate(${n.layout.x} ${n.layout.y})`}>
        {n.kind === 'wild' ? <circle r="22"/> : <rect x="-22" y="-22" width="44" height="44" rx={n.kind === 'street' ? 10 : 0}/>}
        <text textAnchor="middle" y="5" className="node-symbol">{n.isCurrent ? '@' : n.discovery === 'frontier' ? '?' : '·'}</text><text textAnchor="middle" y="42">{n.name}</text>
      </g>)}
    </svg></>;
}
function SceneArt({ kind }: { kind: string }) {
  return <svg className="scene-art" viewBox="0 0 600 360" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <rect width="600" height="360" fill="#eeeade"/>
    {kind === 'indoor' ? <><rect x="55" y="40" width="490" height="260" fill="#e1dbc9"/><path d="M30 40H570 M60 40V320 M540 40V320 M60 95H540" stroke="#655f50" strokeWidth="15"/><rect x="220" y="65" width="160" height="150" fill="#bcc9b0"/><path d="M260 65V215 M300 65V215 M340 65V215 M220 115H380 M220 165H380" stroke="#777a63" strokeWidth="5"/><path d="M95 280H200M110 280V330M185 280V330" stroke="#83765e" strokeWidth="12"/></> : <><path d="M0 210L90 80 170 155 260 55 370 180 450 95 600 200V360H0Z" fill="#c5cebd"/><path d="M0 260L130 140 220 240 390 125 600 260V360H0Z" fill="#a6b79f" opacity=".6"/>{kind === 'street' ? <><path d="M0 200L100 150 195 200Z M425 205L505 145 600 200Z" fill="#6f7d69"/><path d="M25 205H165V300H25Z M445 205H580V300H445Z" fill="#c3bca4"/><path d="M270 240L180 360H480L340 240" fill="#dfdacb"/><path d="M238 285H380 M208 325H432" stroke="#aaa995"/></> : <><path d="M310 235Q180 290 330 310T400 360" fill="none" stroke="#dce5dc" strokeWidth="35"/><path d="M60 290V165 M545 300V145" stroke="#6d7c63" strokeWidth="11"/><path d="M20 205L62 110 108 205Z M500 195L548 75 590 195Z" fill="#819777"/></>}</>}
    <path d="M0 345Q130 310 245 340T600 330V360H0Z" fill="#939d81" opacity=".25"/>
  </svg>;
}
