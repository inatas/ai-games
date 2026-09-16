import { randomUUID } from 'node:crypto';
import type { PostgresStore } from '@game-ai/storage';
import { HarnessError, type Binding, type MemoryChange, type Transaction } from '@game-ai/core';
import { ScriptedModel } from '@game-ai/model';
import { world } from './world.ts';
import { readWorldState, makeScene, type WorldState } from './scene.ts';

export const actions = ['good_deed', 'encounter', 'apprenticeship', 'challenge', 'move', 'talk', 'accept_quest', 'pickup', 'give'] as const;
export type Action = typeof actions[number];
type Input = { note: string; exitId?: string; targetId?: string; topicId?: string; questId?: string; itemId?: string };
function inputSchema(action: Action) {
  const fields: Partial<Record<Action, string[]>> = { move: ['exitId'], talk: ['targetId', 'topicId'], accept_quest: ['targetId', 'questId'], pickup: ['itemId'], give: ['targetId', 'questId', 'itemId'] };
  return { type: 'object', additionalProperties: false, required: ['note', ...(fields[action] ?? [])], properties: {
    note: { type: 'string', maxLength: 200 },
    ...Object.fromEntries((fields[action] ?? []).map(key => [key, { type: 'string', minLength: 1, maxLength: 80 }])),
  } };
}
export async function migrateGame(store: PostgresStore) {
  await store.transaction(async tx => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('wuxia-world-migration'))");
    await tx.query(`CREATE TABLE IF NOT EXISTS wuxia_characters (
      scope_id uuid PRIMARY KEY REFERENCES fw_scopes(id), silver integer NOT NULL DEFAULT 20 CHECK(silver>=0),
      virtue integer NOT NULL DEFAULT 0 CHECK(virtue>=0), skill integer NOT NULL DEFAULT 1 CHECK(skill>=0),
      master text, encounter_done boolean NOT NULL DEFAULT false, good_deed_item_id text,
      host_version integer NOT NULL DEFAULT 0, access_hash text NOT NULL)`);
    await tx.query(`ALTER TABLE wuxia_characters ADD COLUMN IF NOT EXISTS current_room_id text;
      ALTER TABLE wuxia_characters ADD COLUMN IF NOT EXISTS world_content_version text;
      CREATE TABLE IF NOT EXISTS wuxia_discovered_rooms(scope_id uuid REFERENCES fw_scopes(id),room_id text,PRIMARY KEY(scope_id,room_id));
      CREATE TABLE IF NOT EXISTS wuxia_npc_states(scope_id uuid REFERENCES fw_scopes(id),npc_id text,room_id text NOT NULL,status text NOT NULL DEFAULT 'present',PRIMARY KEY(scope_id,npc_id));
      CREATE TABLE IF NOT EXISTS wuxia_inventory(scope_id uuid REFERENCES fw_scopes(id),item_id text,quantity integer NOT NULL CHECK(quantity BETWEEN 0 AND 1),PRIMARY KEY(scope_id,item_id));
      CREATE TABLE IF NOT EXISTS wuxia_quests(scope_id uuid REFERENCES fw_scopes(id),quest_id text,status text NOT NULL CHECK(status IN ('not_started','active','completed')),PRIMARY KEY(scope_id,quest_id));
      UPDATE wuxia_characters SET current_room_id=COALESCE(current_room_id,'gate'),world_content_version=COALESCE(world_content_version,'1');
      INSERT INTO wuxia_discovered_rooms SELECT scope_id,current_room_id FROM wuxia_characters ON CONFLICT DO NOTHING;
      INSERT INTO wuxia_quests SELECT scope_id,'medicine','not_started' FROM wuxia_characters ON CONFLICT DO NOTHING;`);
    for (const npc of world.npcs) await tx.query('INSERT INTO wuxia_npc_states(scope_id,npc_id,room_id) SELECT scope_id,$1,$2 FROM wuxia_characters ON CONFLICT DO NOTHING', [npc.id, npc.roomId]);
    if ((await tx.query('SELECT 1 FROM wuxia_characters WHERE world_content_version<>$1 LIMIT 1', [world.version])).rowCount) throw new Error('Unsupported world content version');
  });
}
export function publicState(row: any) {
  return { silver: row.silver, virtue: row.virtue, skill: row.skill, master: row.master, encounterDone: row.encounter_done, hostVersion: row.host_version };
}
export async function initializeGame(store: PostgresStore, tx: Transaction, id: string) {
  const row = (await tx.query("INSERT INTO wuxia_characters(scope_id,access_hash,current_room_id,world_content_version) VALUES($1,'account-managed','gate',$2) RETURNING *", [id, world.version])).rows[0];
  await tx.query("INSERT INTO wuxia_discovered_rooms VALUES($1,'gate')", [id]);
  await tx.query("INSERT INTO wuxia_quests VALUES($1,'medicine','not_started')", [id]);
  for (const npc of world.npcs) await tx.query('INSERT INTO wuxia_npc_states(scope_id,npc_id,room_id) VALUES($1,$2,$3)', [id, npc.id, npc.roomId]);
  await store.applyMemory(tx, id, [{ op: 'replace_fact', key: 'character', payload: publicState(row), sourceVersion: '0' }]);
}
export async function createGame(store: PostgresStore, accessHash: string) {
  const id = randomUUID();
  await store.transaction(async tx => {
    await tx.query('INSERT INTO fw_scopes(id) VALUES($1)', [id]);
    await initializeGame(store, tx, id);
    await tx.query('UPDATE wuxia_characters SET access_hash=$2 WHERE scope_id=$1', [id, accessHash]);
  });
  return id;
}
const targets: Partial<Record<Action, string>> = { good_deed: 'villager', apprenticeship: 'master', challenge: 'disciple', accept_quest: 'herbalist', give: 'herbalist' };
function deny(action: Action, input: Input, s: WorldState): string | null {
  const row = s.row;
  const target = targets[action] ?? (action === 'talk' ? input.targetId : undefined);
  if (target && (!s.npcs.some(n => n.npc_id === target && n.status === 'present') || (input.targetId && input.targetId !== target))) return 'TARGET_NOT_PRESENT';
  if (action === 'move') {
    const exit = world.exits.find(e => e.id === input.exitId && e.from === row.current_room_id);
    if (!exit) return 'NOT_ADJACENT';
    if (exit.requiresMaster && !row.master) return 'EXIT_LOCKED';
  }
  if (action === 'talk' && input.topicId !== 'news') return 'INVALID_TOPIC';
  if (['accept_quest', 'give'].includes(action) && input.questId !== 'medicine') return 'QUEST_NOT_ACTIVE';
  if (action === 'accept_quest' && s.quest !== 'not_started') return s.quest === 'completed' ? 'QUEST_COMPLETED' : 'QUEST_ALREADY_ACTIVE';
  if (action === 'give' || action === 'pickup') {
    if (s.quest === 'completed') return 'QUEST_COMPLETED';
    if (s.quest !== 'active') return 'QUEST_NOT_ACTIVE';
    if (input.itemId !== 'medicine') return 'ITEM_NOT_AVAILABLE';
    if (action === 'pickup' && (row.current_room_id !== 'forest' || s.quantity !== 0)) return 'ITEM_NOT_AVAILABLE';
    if (action === 'give' && s.quantity !== 1) return 'ITEM_REQUIRED';
  }
  if (action === 'good_deed' && row.silver < 2) return 'INSUFFICIENT_SILVER';
  if (action === 'encounter' && row.current_room_id !== 'stream') return 'TARGET_NOT_PRESENT';
  if (action === 'encounter' && row.encounter_done) return 'ENCOUNTER_COMPLETED';
  if (action === 'apprenticeship' && row.master) return 'ALREADY_APPRENTICED';
  if (action === 'apprenticeship' && row.virtue < 2) return 'LOW_VIRTUE';
  return null;
}
function check(action: Action, input: Input, s: WorldState) {
  const reason = deny(action, input, s);
  if (reason) throw new HarnessError('RULE_REJECTED', 409, reason);
}
const answers = { GUIDE: '若想熟悉青溪镇，可去药铺帮药师解忧，也可到武馆问道。', KINDNESS: '善行自有回响。镇上的人会记得你的相助。' };
export function gameBinding(store: PostgresStore, action: Action): Binding {
  const ai = ['encounter', 'apprenticeship', 'talk'].includes(action);
  const choices = action === 'encounter' ? ['GIFT', 'GUIDANCE'] : ['ACCEPT', 'DEFER'];
  const outputSchema = action === 'talk'
    ? { type: 'object', additionalProperties: false, required: ['answerId'], properties: { answerId: { type: 'string', enum: Object.keys(answers) } } }
    : { type: 'object', additionalProperties: false, required: ['choice'], properties: { choice: { type: 'string', enum: choices } } };
  return {
    id: `wuxia.${action}`, version: '1', mode: ai ? 'assessment' : 'recordMemory', inputSchema: inputSchema(action), ...(ai ? { outputSchema } : {}),
    async prepare(raw, scopeId) {
      const input = raw as Input;
      return store.transaction(async tx => {
        await tx.query('SELECT id FROM fw_scopes WHERE id=$1 FOR SHARE', [scopeId]);
        const s = await readWorldState(tx, scopeId); check(action, input, s);
        const target = targets[action] ?? input.targetId; const scene = makeScene(s);
        const open = action === 'encounter' && s.row.good_deed_item_id
          ? (await tx.query("SELECT id FROM fw_memory WHERE scope_id=$1 AND id=$2 AND status='open'", [scopeId, s.row.good_deed_item_id])).rows.map(r => r.id) : [];
        return {
          gameVersion: String(s.row.host_version),
          facts: { player: publicState(s.row), room: { id: scene.roomId, name: scene.name, description: scene.description },
            actor: scene.objects.filter(o => o.id === target).map(o => ({ id: o.id, name: o.name, description: o.description })), quest: s.quest, hasMedicine: s.quantity === 1 },
          instructions: action === 'talk' ? `你为当前NPC选择本地见闻答复。只输出answerId。可选模板：${JSON.stringify(answers)}。参考当前事实和行善历史，不虚构奖励。`
            : action === 'encounter' ? '你是武侠奇遇判定员。参考行善历史与当前事实，选择GIFT（物资帮助）或GUIDANCE（武学指点）。'
              : '你判定青松道人的收徒态度。参考行善记录和玩家说明，只选择ACCEPT或DEFER，硬资格由游戏保证。',
          subjectIds: target ? [target] : [], tags: ['good_deed', ...(target ? [`npc:${target}`] : [])], requiredMemoryIds: open,
        };
      });
    },
    validate() { return { ok: true }; },
    async apply(tx, proposal, context) {
      await tx.query('SELECT scope_id FROM wuxia_characters WHERE scope_id=$1 FOR UPDATE', [context.scopeId]);
      const s = await readWorldState(tx, context.scopeId); const row = s.row; const input = context.input as Input;
      if (String(row.host_version) !== context.gameVersion) throw new HarnessError('STATE_CONFLICT');
      check(action, input, s);
      const before = publicState(row); const choice = (proposal as any)?.choice;
      const eventId = randomUUID(); const memoryChanges: MemoryChange[] = []; let message = '';
      if (action === 'move') {
        row.current_room_id = world.exits.find(e => e.id === input.exitId)!.to;
        await tx.query('INSERT INTO wuxia_discovered_rooms VALUES($1,$2) ON CONFLICT DO NOTHING', [context.scopeId, row.current_room_id]);
        message = `你来到${world.rooms.find(r => r.id === row.current_room_id)!.name}。`;
      } else if (action === 'accept_quest') {
        await tx.query("UPDATE wuxia_quests SET status='active' WHERE scope_id=$1 AND quest_id='medicine'", [context.scopeId]); message = '药师托你寻回遗失在林地的药包。';
      } else if (action === 'pickup') {
        await tx.query("INSERT INTO wuxia_inventory VALUES($1,'medicine',1) ON CONFLICT(scope_id,item_id) DO UPDATE SET quantity=1", [context.scopeId]); message = '你拾起药包，准备送回药铺。';
      } else if (action === 'give') {
        await tx.query("DELETE FROM wuxia_inventory WHERE scope_id=$1 AND item_id='medicine'", [context.scopeId]);
        await tx.query("UPDATE wuxia_quests SET status='completed' WHERE scope_id=$1 AND quest_id='medicine'", [context.scopeId]);
        row.silver += 2; message = '药师接过药包，赠你二两银钱。寻药委托已完成。';
      } else if (action === 'talk') {
        const npc = world.npcs.find(n => n.id === input.targetId)!;
        message = `${npc.name}：${answers[(proposal as any).answerId as keyof typeof answers]}`;
        if (npc.id === 'villager' && (await tx.query("SELECT 1 FROM fw_memory WHERE scope_id=$1 AND kind='event' AND payload->>'action'='good_deed' LIMIT 1", [context.scopeId])).rowCount) message += ' 多谢你先前的接济，我一直记在心里。';
      } else if (action === 'good_deed') {
        row.silver -= 2; row.virtue += 1; message = '你以二两银钱接济村民。侠义 +1。';
        if (!row.good_deed_item_id) {
          row.good_deed_item_id = randomUUID(); memoryChanges.push({ op: 'open_item', id: row.good_deed_item_id, payload: '曾帮助村民，后续相遇可参考。', sourceIds: [eventId], subjectIds: ['player'] });
        }
      } else if (action === 'challenge') {
        if (row.skill >= 2) { row.silver += 3; message = '切磋获胜，获得三两银钱。'; } else message = '切磋落败。你意识到还需修习武学。';
      } else if (action === 'apprenticeship') {
        if (choice === 'ACCEPT') { row.master = '青松道人'; row.skill += 1; message = '青松道人收你为徒，传授入门心法。武学 +1。'; } else message = '青松道人暂缓收徒，邀你继续历练。';
      } else if (action === 'encounter') {
        if (choice === 'GIFT') { row.silver += 4; message = '江湖故人赠你四两银钱，助你远行。'; } else { row.skill += 1; message = '你得到高人指点。武学 +1。'; }
        row.encounter_done = true;
        if (row.good_deed_item_id && (await tx.query("SELECT id FROM fw_memory WHERE scope_id=$1 AND id=$2 AND status='open'", [context.scopeId, row.good_deed_item_id])).rowCount) memoryChanges.push({ op: 'close_item', id: row.good_deed_item_id });
      }
      row.host_version += 1;
      await tx.query(`UPDATE wuxia_characters SET silver=$2,virtue=$3,skill=$4,master=$5,encounter_done=$6,good_deed_item_id=$7,host_version=$8,current_room_id=$9 WHERE scope_id=$1`,
        [context.scopeId, row.silver, row.virtue, row.skill, row.master, row.encounter_done, row.good_deed_item_id, row.host_version, row.current_room_id]);
      const after = publicState(row); const target = targets[action] ?? input.targetId;
      memoryChanges.unshift({ op: 'append_event', id: eventId, payload: { action, message, before, after, roomId: row.current_room_id }, subjectIds: action === 'move' ? ['travel'] : ['player', ...(target ? [target] : [])], tags: [action, ...(target ? [`npc:${target}`] : [])] });
      memoryChanges.push({ op: 'replace_fact', key: 'character', payload: after, sourceVersion: String(row.host_version) });
      return { result: { message, state: after, action }, memoryChanges };
    },
  };
}
export const demoModel = () => new ScriptedModel(request => {
  const p = (request.outputSchema as any).properties;
  return p.answerId ? JSON.stringify({ answerId: p.answerId.enum[0] }) : JSON.stringify({ choice: p.choice.enum.includes('GUIDANCE') ? 'GUIDANCE' : 'ACCEPT' });
});
