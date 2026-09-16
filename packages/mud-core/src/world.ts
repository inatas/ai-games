export type RoomKind = 'street' | 'indoor' | 'wild';
export interface Room {
  id: string; name: string; kind: RoomKind; templateId: RoomKind;
  description: string; layout: { x: number; y: number };
}
export interface Exit { id: string; from: string; to: string; direction: string; requirement?: string }
export interface Npc { id: string; name: string; roomId: string; description: string }
export interface World { version: string; rooms: Room[]; exits: Exit[]; npcs: Npc[] }
const indices = new WeakMap<World, { rooms: Map<string, Room>; exits: Map<string, Exit[]> }>();
export function validateWorld(value: World, start = value.rooms[0]?.id) {
  const rooms = new Map<string, Room>();
  for (const r of value.rooms) {
    if (rooms.has(r.id) || !['street', 'indoor', 'wild'].includes(r.templateId) || !Number.isFinite(r.layout.x) || !Number.isFinite(r.layout.y))
      throw new Error(`Invalid room: ${r.id}`);
    rooms.set(r.id, r);
  }
  const exits = new Map<string, Exit[]>(); const ids = new Set<string>();
  for (const e of value.exits) {
    if (ids.has(e.id) || !rooms.has(e.from) || !rooms.has(e.to)) throw new Error(`Invalid exit: ${e.id}`);
    ids.add(e.id);
    const outgoing = exits.get(e.from) ?? [];
    outgoing.push(e); exits.set(e.from, outgoing);
    if (outgoing.length > 8) throw new Error(`Too many exits: ${e.from}`);
  }
  const npcIds = new Set<string>();
  for (const npc of value.npcs) {
    if (npcIds.has(npc.id) || !rooms.has(npc.roomId)) throw new Error(`Invalid NPC: ${npc.id}`);
    npcIds.add(npc.id);
  }
  if (!rooms.has(start)) throw new Error(`Missing start: ${start}`);
  const reached = new Set([start]); const queue = [start];
  for (let i = 0; i < queue.length; i++) for (const e of exits.get(queue[i]) ?? []) {
    if (!reached.has(e.to)) { reached.add(e.to); queue.push(e.to); }
  }
  if (reached.size !== rooms.size) throw new Error('Unreachable rooms');
  indices.set(value, { rooms, exits });
}

export function projectMap(value: World, current: string, discovered: Set<string>, access: (exit: Exit) => string | null) {
  let index = indices.get(value);
  if (!index) { validateWorld(value, current); index = indices.get(value)!; }
  const outgoing = index.exits.get(current) ?? [];
  const frontier = new Set(outgoing.map(e => e.to));
  const nearby = new Set([current]); let layer = [current];
  for (let step = 0; step < 2; step++) {
    const next: string[] = [];
    for (const id of layer) for (const e of index.exits.get(id) ?? []) {
      if (!nearby.has(e.to)) { nearby.add(e.to); next.push(e.to); }
    }
    layer = next;
  }
  const visible = new Set([...nearby].filter(id => id === current || discovered.has(id) || frontier.has(id)));
  const nodes = [...visible].map(id => {
    const r = index!.rooms.get(id)!;
    return { roomId: id, name: r.name, kind: r.kind, layout: r.layout, discovery: discovered.has(id) ? 'visited' as const : 'frontier' as const, isCurrent: id === current };
  });
  const edges = [...visible].flatMap(id => (index!.exits.get(id) ?? [])
    .filter(e => visible.has(e.to) && (e.from === current || (discovered.has(e.from) && discovered.has(e.to))))
    .map(e => ({ exitId: e.id, from: e.from, to: e.to, direction: e.direction,
      bidirectional: (index!.exits.get(e.to) ?? []).some(back => back.to === e.from),
      access: e.from !== current ? 'unknown' as const : access(e) !== null ? 'locked' as const : 'open' as const,
      ...(e.from === current && access(e) !== null ? { reason: access(e)! } : {}),
    })));
  return { regionId: value.version, name: value.version, currentRoomId: current, radius: 2, nodes, edges };
}
