import type { Transaction } from '@game-ai/core';
import { HarnessError } from '@game-ai/core';
import { world, projectMap } from './world.ts';

export interface GameAction { action: string; label: string; targetId?: string; topicId?: string; questId?: string; itemId?: string; exitId?: string }
export interface SceneObject { id: string; name: string; kind: 'npc' | 'item' | 'fixture'; description: string; layout: { x: number; y: number }; actions: GameAction[] }
export async function readWorldState(tx: Transaction, scopeId: string) {
  const row = (await tx.query('SELECT * FROM wuxia_characters WHERE scope_id=$1', [scopeId])).rows[0];
  if (!row) throw new HarnessError('NOT_FOUND', 404);
  if (row.world_content_version !== world.version) throw new Error('Unsupported world content version');
  const discovered = new Set<string>((await tx.query('SELECT room_id FROM wuxia_discovered_rooms WHERE scope_id=$1', [scopeId])).rows.map(r => r.room_id));
  const npcs = (await tx.query('SELECT npc_id,room_id,status FROM wuxia_npc_states WHERE scope_id=$1 AND room_id=$2', [scopeId, row.current_room_id])).rows;
  const quantity = (await tx.query("SELECT quantity FROM wuxia_inventory WHERE scope_id=$1 AND item_id='medicine'", [scopeId])).rows[0]?.quantity ?? 0;
  const quest = (await tx.query("SELECT status FROM wuxia_quests WHERE scope_id=$1 AND quest_id='medicine'", [scopeId])).rows[0]?.status ?? 'not_started';
  return { row, discovered, npcs, quantity: quantity as number, quest: quest as 'not_started' | 'active' | 'completed' };
}
export type WorldState = Awaited<ReturnType<typeof readWorldState>>;
export function makeScene(s: WorldState) {
  const room = world.rooms.find(r => r.id === s.row.current_room_id)!;
  const objects: SceneObject[] = s.npcs.filter(n => n.status === 'present').map((n, i) => {
    const npc = world.npcs.find(x => x.id === n.npc_id)!;
    const actions: GameAction[] = [{ action: 'talk', label: '交谈 · 本地见闻', targetId: npc.id, topicId: 'news' }];
    if (npc.id === 'herbalist') {
      if (s.quest === 'not_started') actions.push({ action: 'accept_quest', label: '接受寻药委托', targetId: npc.id, questId: 'medicine' });
      if (s.quest === 'active' && s.quantity === 1) actions.push({ action: 'give', label: '交付药包', targetId: npc.id, questId: 'medicine', itemId: 'medicine' });
    }
    if (npc.id === 'villager' && s.row.silver >= 2) actions.push({ action: 'good_deed', label: '行善 · 二两银钱' });
    if (npc.id === 'master' && !s.row.master && s.row.virtue >= 2) actions.push({ action: 'apprenticeship', label: '请求拜师' });
    if (npc.id === 'disciple') actions.push({ action: 'challenge', label: '切磋武艺' });
    return { id: npc.id, name: npc.name, kind: 'npc', description: npc.description, layout: { x: 45 + i * 20, y: 62 }, actions };
  });
  if (room.id === 'forest' && s.quest === 'active' && s.quantity === 0)
    objects.push({ id: 'medicine', name: '药包', kind: 'item', description: '落叶间露出一角布包，散发着药香。', layout: { x: 65, y: 72 }, actions: [{ action: 'pickup', label: '拾取药包', itemId: 'medicine' }] });
  if (room.id === 'stream') objects.push({ id: 'stone', name: '旧石碑', kind: 'fixture', description: s.row.encounter_done ? '旧缘已结，碑上水痕依旧。' : '碑文模糊，似有故人的指引。', layout: { x: 65, y: 62 }, actions: s.row.encounter_done ? [] : [{ action: 'encounter', label: '查看石碑 · 奇遇' }] });
  return { roomId: room.id, name: room.name, templateId: room.templateId, description: room.description, objects };
}
export function worldProjection(s: WorldState) {
  return {
    worldContentVersion: world.version,
    map: projectMap(world, s.row.current_room_id, s.discovered, !!s.row.master), scene: makeScene(s),
    inventory: s.quantity ? [{ itemId: 'medicine', name: '药包', quantity: s.quantity }] : [],
    quests: [{ questId: 'medicine', name: '寻回药包', status: s.quest, description: s.quest === 'not_started' ? '去药铺问问药师有何烦忧。' : s.quest === 'completed' ? '药包已归还。药师赠你二两银钱。' : s.quantity ? '回药铺，将药包交给药师。' : '沿广场南行，去林地寻找药包。' }],
  };
}
