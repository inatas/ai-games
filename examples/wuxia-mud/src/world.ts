export type RoomKind = 'street' | 'indoor' | 'wild';
export interface Room {
  id: string; name: string; kind: RoomKind; templateId: RoomKind;
  description: string; layout: { x: number; y: number };
}
export interface Exit { id: string; from: string; to: string; direction: string; requiresMaster?: boolean }
export interface Npc { id: string; name: string; roomId: string; description: string }
export interface World { version: string; rooms: Room[]; exits: Exit[]; npcs: Npc[] }
const room = (id: string, name: string, kind: RoomKind, x: number, y: number, description: string): Room =>
  ({ id, name, kind, templateId: kind, layout: { x, y }, description });
const links: [string, string, string, string][] = [
  ['gate', 'street', '东', '西'], ['street', 'tea', '东', '西'], ['tea', 'tea-yard', '后门', '前厅'],
  ['street', 'herbalist', '南', '北'], ['herbalist', 'square', '南', '北'],
  ['square', 'dojo', '东', '西'], ['dojo', 'dojo-yard', '后门', '前厅'],
  ['dojo-yard', 'inner', '内室', '出门'], ['square', 'trail', '南', '北'],
  ['trail', 'forest', '东', '西'], ['forest', 'stream', '东', '西'],
];
export const world: World = {
  version: '1',
  rooms: [
    room('gate', '村口', 'street', 70, 60, '旧木牌写着青溪镇。远山如黛，石路向镇中延伸。'),
    room('street', '青石街', 'street', 210, 60, '青石被岁月磨得温润，街边传来茶香与药香。'),
    room('tea', '茶馆', 'indoor', 350, 60, '梁下茶烟袅袅，店小二正擦拭桌案。'),
    room('tea-yard', '茶馆后院', 'street', 490, 60, '竹影扫过石墙，一扇便门通向青石街，只可由内推开。'),
    room('herbalist', '药铺', 'indoor', 210, 190, '药柜排列整齐，老药师似乎正为一件事发愁。'),
    room('square', '广场', 'street', 210, 320, '老树下歇着一位村民，向来往旅人拱手致意。'),
    room('dojo', '武馆', 'indoor', 350, 320, '青松道人静坐堂前，听院中习武之声。'),
    room('dojo-yard', '武馆后院', 'street', 490, 320, '木桩旁，武馆弟子邀人切磋。内室门扉半掩。'),
    room('inner', '内室', 'indoor', 630, 320, '一室清静，案上放着入门心法。'),
    room('trail', '山道', 'wild', 210, 450, '山路渐窄，风过松梢。'),
    room('forest', '林地', 'wild', 350, 450, '树影交错，落叶覆着林间小径。'),
    room('stream', '溪边', 'wild', 490, 450, '溪水绕过旧石碑，仿佛留着前人的故事。'),
  ],
  exits: [
    ...links.flatMap(([a, b, outward, inward]) => [
      { id: `${a}:${b}`, from: a, to: b, direction: outward, ...(b === 'inner' ? { requiresMaster: true } : {}) },
      { id: `${b}:${a}`, from: b, to: a, direction: inward },
    ]),
    { id: 'tea-yard:street', from: 'tea-yard', to: 'street', direction: '便门' },
  ],
  npcs: [
    { id: 'waiter', name: '店小二', roomId: 'tea', description: '熟悉镇上见闻，待人爽朗。' },
    { id: 'herbalist', name: '药师', roomId: 'herbalist', description: '悬壶济世，正在寻找遗失的药包。' },
    { id: 'villager', name: '村民', roomId: 'square', description: '生活清苦，记得旅人的善意。' },
    { id: 'master', name: '青松道人', roomId: 'dojo', description: '重品行，亦重勤学。' },
    { id: 'disciple', name: '武馆弟子', roomId: 'dojo-yard', description: '以武会友，点到即止。' },
  ],
};

const indices = new WeakMap<World, { rooms: Map<string, Room>; exits: Map<string, Exit[]> }>();
export function validateWorld(value: World, start = 'gate') {
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

export function projectMap(value: World, current: string, discovered: Set<string>, master: boolean) {
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
      access: e.from !== current ? 'unknown' as const : e.requiresMaster && !master ? 'locked' as const : 'open' as const,
      ...(e.from === current && e.requiresMaster && !master ? { reason: '拜入青松道人门下后可进入' } : {}),
    })));
  return { regionId: 'qingxi', name: '青溪镇与近郊', currentRoomId: current, radius: 2, nodes, edges };
}
validateWorld(world);
