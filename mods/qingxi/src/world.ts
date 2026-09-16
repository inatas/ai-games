import { projectMap as projectTopology, validateWorld, type World, type RoomKind, type Room } from '@game-ai/mud-core';
export { validateWorld };
export type { World };
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
      { id: `${a}:${b}`, from: a, to: b, direction: outward, ...(b === 'inner' ? { requirement: 'master' } : {}) },
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


export function projectMap(value: World,current:string,discovered:Set<string>,master:boolean) {
  return {...projectTopology(value,current,discovered,e=>e.requirement==='master'&&!master?'拜入师门后可进入':null),regionId:'qingxi',name:'青溪镇与近郊'};
}
validateWorld(world);
