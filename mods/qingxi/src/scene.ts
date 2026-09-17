import type { Transaction } from '@game-ai/core';
import { HarnessError } from '@game-ai/core';
import { map as world, projectMap } from './map.ts';
import { npcs } from './npcs.ts';
import { itemQuantity } from '@game-ai/game-systems';
import { schools, trainingDenial } from './training.ts';

import type { GameAction, SceneObject } from '@game-ai/game-systems';
export type { GameAction, SceneObject } from '@game-ai/game-systems';
export async function readWorldState(tx: Transaction, scopeId: string) {
  const row = (await tx.query('SELECT * FROM wuxia_characters WHERE scope_id=$1', [scopeId])).rows[0];
  if (!row) throw new HarnessError('NOT_FOUND', 404);
  if (row.world_content_version !== world.version) throw new Error('Unsupported world content version');
  const discovered = new Set<string>((await tx.query('SELECT room_id FROM wuxia_discovered_rooms WHERE scope_id=$1', [scopeId])).rows.map(r => r.room_id));
  const npcs = (await tx.query('SELECT n.npc_id,n.room_id,n.status FROM mud_npcs n JOIN mud_characters c ON c.realm_id=n.realm_id WHERE c.scope_id=$1 AND n.room_id=$2', [scopeId, row.current_room_id])).rows;
  const quantity = await itemQuantity(tx,scopeId,'medicine');
  const quest = (await tx.query("SELECT status FROM wuxia_quests WHERE scope_id=$1 AND quest_id='medicine'", [scopeId])).rows[0]?.status ?? 'not_started';
  const skills = (await tx.query('SELECT skill_id,level FROM wuxia_skills WHERE scope_id=$1 ORDER BY skill_id', [scopeId])).rows;
  const schoolQuest = (await tx.query('SELECT school_id,status,cycle,enemy_hp FROM wuxia_school_quests WHERE scope_id=$1', [scopeId])).rows[0] ?? null;
  return { row, discovered, npcs, quantity: quantity as number, quest: quest as 'not_started' | 'active' | 'completed', skills, schoolQuest };
}
export type WorldState = Awaited<ReturnType<typeof readWorldState>>;
export function makeScene(s: WorldState) {
  const room = world.rooms.find(r => r.id === s.row.current_room_id)!;
  const objects: SceneObject[] = s.npcs.filter(n => n.status === 'present').map((n, i) => {
    const npc = npcs.find(x => x.id === n.npc_id)!;
    const actions: GameAction[] = [{ action: 'talk', label: '交谈 · 本地见闻', targetId: npc.id, topicId: 'news' }];
    if (npc.id === 'herbalist') {
      actions.push({action:'escort_accept',label:'两人领取护送委托'},{action:'escort_complete',label:'提交护送委托'},{action:'escort_claim',label:'领取护送奖励'});
      if (s.quest === 'not_started') actions.push({ action: 'accept_quest', label: '接受寻药委托', targetId: npc.id, questId: 'medicine' });
      if (s.quest === 'active' && s.quantity === 1) actions.push({ action: 'give', label: '交付药包', targetId: npc.id, questId: 'medicine', itemId: 'medicine' });
      if (!s.row.school_id) actions.push({ action: 'join_school', label: '拜入百草门', schoolId: 'baicao' });
      if (s.row.school_id === 'baicao' && !s.schoolQuest) actions.push({ action: 'accept_school_quest', label: '领取师门任务', schoolId: 'baicao' });
      if (s.row.school_id === 'baicao' && s.schoolQuest?.status === 'ready') actions.push({ action: 'turn_in_school_quest', label: '交付师门任务', schoolId: 'baicao' });
    }
    if (npc.id === 'villager' && s.row.silver >= 2) actions.push({ action: 'good_deed', label: '行善 · 二两银钱' });
    if (npc.id === 'master' && !s.row.master && s.row.virtue >= 2) actions.push({ action: 'apprenticeship', label: '请求拜师' });
    if (npc.id === 'master' && !s.row.school_id) actions.push({ action: 'join_school', label: '拜入青松门', schoolId: 'qingsong' });
    if (npc.id === 'master' && s.row.school_id === 'qingsong' && !s.schoolQuest) actions.push({ action: 'accept_school_quest', label: '领取师门任务', schoolId: 'qingsong' });
    if (npc.id === 'master' && s.row.school_id === 'qingsong' && s.schoolQuest?.status === 'ready') actions.push({ action: 'turn_in_school_quest', label: '交付师门任务', schoolId: 'qingsong' });
    if (npc.id === 'disciple') actions.push({ action: 'challenge', label: '切磋武艺' });
    return { id: npc.id, name: npc.name, kind: 'npc', description: npc.description, layout: { x: 45 + i * 20, y: 62 }, actions };
  });
  if (room.id === 'forest' && s.quest === 'active' && s.quantity === 0)
    objects.push({ id: 'medicine', name: '药包', kind: 'item', description: '落叶间露出一角布包，散发着药香。', layout: { x: 65, y: 72 }, actions: [{ action: 'pickup', label: '拾取药包', itemId: 'medicine' }] });
  if(room.id==='forest') objects.push({id:'route',name:'药路',kind:'fixture',description:'同队两人各自勘察一次，再回药铺复命。',layout:{x:35,y:60},actions:[{action:'escort_contribute',label:'勘察药路'}]});
  if (room.id === 'stream') objects.push({ id: 'stone', name: '旧石碑', kind: 'fixture', description: s.row.encounter_done ? '旧缘已结，碑上水痕依旧。' : '碑文模糊，似有故人的指引。', layout: { x: 65, y: 62 }, actions: s.row.encounter_done ? [] : [{ action: 'encounter', label: '查看石碑 · 奇遇' }] });
  if (room.id === 'trail' && s.schoolQuest?.status === 'active') objects.push({ id: 'bandit', name: '拦路恶徒', kind: 'npc', description: `恶徒气血 ${s.schoolQuest.enemy_hp}/12，正拦在山道中央。`, layout: { x: 66, y: 58 }, actions: [
    { action: 'attack', label: '普通攻击', enemyId: 'bandit' },
    ...(s.row.school_id ? [{ action: 'use_skill', label: '施展门派武学', enemyId: 'bandit', skillId: s.row.school_id === 'qingsong' ? 'qingsong_sword' : 'acupoint_hand' }] : []),
  ] });
  return { roomId: room.id, name: room.name, templateId: room.templateId, description: room.description, objects };
}
export function worldProjection(s: WorldState) {
  const school = schools[s.row.school_id as keyof typeof schools];
  return {
    title:'青溪镇', characterName:s.row.player_name as string,
    forms:[{action:'set_profile',label:'修改角色档案',fields:[{id:'name',label:'姓名',value:s.row.player_name as string,maxLength:12},{id:'gender',label:'性别',value:s.row.gender as string,options:['未设定','男','女']}]}],
    attributes:[{label:'气血',value:`${s.row.hp}/30`},{label:'内力',value:`${s.row.qi}/10`},{label:'经验',value:Number(s.row.experience)},{label:'潜能',value:Number(s.row.potential)},{label:'银两',value:Number(s.row.silver)},{label:'侠义',value:Number(s.row.virtue)},{label:'师承',value:s.row.master??'无'}],
    training:(school ? [[school.basic,school.basicName],[school.advanced,school.advancedName]] : []).map(([id,name])=>({
      action:'learn_skill',label:`修习${name}（2潜能）`,skillId:id,
      unavailableReason:trainingDenial(s.row,s.skills,id)?.reason,
    })),
    worldContentVersion: world.version,
    map: projectMap(world, s.row.current_room_id, s.discovered, !!s.row.master), scene: makeScene(s),
    inventory: s.quantity ? [{ itemId: 'medicine', name: '药包', quantity: s.quantity }] : [],
    quests: [{ questId: 'medicine', name: '寻回药包', status: s.quest, description: s.quest === 'not_started' ? '去药铺问问药师有何烦忧。' : s.quest === 'completed' ? '药包已归还。药师赠你二两银钱。' : s.quantity ? '回药铺，将药包交给药师。' : '沿广场南行，去林地寻找药包。' }],
    skills: s.skills.map(r => ({ skillId: r.skill_id as string, level: Number(r.level) })),
    schoolQuest: s.schoolQuest ? { schoolId: s.schoolQuest.school_id as string, status: s.schoolQuest.status as string, cycle: Number(s.schoolQuest.cycle), enemyHp: Number(s.schoolQuest.enemy_hp) } : null,
  };
}
