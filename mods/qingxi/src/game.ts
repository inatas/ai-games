import { randomUUID } from 'node:crypto';
import type { PostgresStore } from '@game-ai/storage';
import { HarnessError, type Binding, type MemoryChange, type Transaction } from '@game-ai/core';
import { ScriptedModel } from '@game-ai/model';
import { world } from './world.ts';
import { migrateMud } from '@game-ai/storage';
import { lockRealm, sharedTask } from '@game-ai/mud-core';
import { realmId, manifest } from './mod.ts';
import { readWorldState, makeScene, type WorldState } from './scene.ts';
import { schools, trainingDenial } from './training.ts';

export const actions = ['good_deed', 'encounter', 'apprenticeship', 'challenge', 'move', 'talk', 'accept_quest', 'pickup', 'give', 'set_profile', 'join_school', 'learn_skill', 'accept_school_quest', 'turn_in_school_quest', 'attack', 'use_skill', 'escort_accept', 'escort_contribute', 'escort_complete', 'escort_claim'] as const;
export type Action = typeof actions[number];
type Input = { note: string; exitId?: string; targetId?: string; topicId?: string; questId?: string; itemId?: string; name?: string; gender?: string; schoolId?: string; skillId?: string; enemyId?: string };
function inputSchema(action: Action) {
  const fields: Partial<Record<Action, string[]>> = { move: ['exitId'], talk: ['targetId', 'topicId'], accept_quest: ['targetId', 'questId'], pickup: ['itemId'], give: ['targetId', 'questId', 'itemId'], set_profile: ['name','gender'], join_school: ['schoolId'], learn_skill: ['skillId'], accept_school_quest: ['schoolId'], turn_in_school_quest: ['schoolId'], attack: ['enemyId'], use_skill: ['enemyId','skillId'] };
  return { type: 'object', additionalProperties: false, required: ['note', ...(fields[action] ?? [])], properties: {
    note: { type: 'string', maxLength: 200 },
    ...Object.fromEntries((fields[action] ?? []).map(key => [key, { type: 'string', minLength: 1, maxLength: 80 }])),
  } };
}
export async function migrateGame(store: PostgresStore) {
  await store.transaction(async tx => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('wuxia-world-migration'))");
    await migrateMud(tx);
    await tx.query('INSERT INTO mud_realms(id,mod_id,mod_version,content_version,worldview_version) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [realmId,manifest.id,manifest.version,manifest.contentVersion,manifest.worldviewVersion]);
    const installedRealm = (await tx.query('SELECT mod_id,mod_version,content_version,worldview_version FROM mud_realms WHERE id=$1', [realmId])).rows[0];
    if (installedRealm.mod_id !== manifest.id || installedRealm.mod_version !== manifest.version ||
        installedRealm.content_version !== manifest.contentVersion || installedRealm.worldview_version !== manifest.worldviewVersion) {
      throw new Error('Installed Qingxi realm version differs from the registered MOD');
    }
    await tx.query(`CREATE TABLE IF NOT EXISTS wuxia_characters (
      scope_id uuid PRIMARY KEY REFERENCES fw_scopes(id), silver integer NOT NULL DEFAULT 20 CHECK(silver>=0),
      virtue integer NOT NULL DEFAULT 0 CHECK(virtue>=0), skill integer NOT NULL DEFAULT 1 CHECK(skill>=0),
      master text, encounter_done boolean NOT NULL DEFAULT false, good_deed_item_id text,
      host_version integer NOT NULL DEFAULT 0, access_hash text NOT NULL)`);
    await tx.query(`ALTER TABLE wuxia_characters ADD COLUMN IF NOT EXISTS current_room_id text;
      ALTER TABLE wuxia_characters ADD COLUMN IF NOT EXISTS world_content_version text;
      ALTER TABLE wuxia_characters ADD COLUMN IF NOT EXISTS player_name text;
      ALTER TABLE wuxia_characters ADD COLUMN IF NOT EXISTS gender text NOT NULL DEFAULT '未设定';
      ALTER TABLE wuxia_characters ADD COLUMN IF NOT EXISTS hp integer NOT NULL DEFAULT 30 CHECK(hp BETWEEN 0 AND 30);
      ALTER TABLE wuxia_characters ADD COLUMN IF NOT EXISTS qi integer NOT NULL DEFAULT 10 CHECK(qi BETWEEN 0 AND 10);
      ALTER TABLE wuxia_characters ADD COLUMN IF NOT EXISTS experience integer NOT NULL DEFAULT 0 CHECK(experience>=0);
      ALTER TABLE wuxia_characters ADD COLUMN IF NOT EXISTS potential integer NOT NULL DEFAULT 0 CHECK(potential>=0);
      ALTER TABLE wuxia_characters ADD COLUMN IF NOT EXISTS school_id text;
      ALTER TABLE wuxia_characters ADD COLUMN IF NOT EXISTS last_active_at bigint NOT NULL DEFAULT 0;
      CREATE TABLE IF NOT EXISTS wuxia_discovered_rooms(scope_id uuid REFERENCES fw_scopes(id),room_id text,PRIMARY KEY(scope_id,room_id));
      CREATE TABLE IF NOT EXISTS wuxia_npc_states(scope_id uuid REFERENCES fw_scopes(id),npc_id text,room_id text NOT NULL,status text NOT NULL DEFAULT 'present',PRIMARY KEY(scope_id,npc_id));
      CREATE TABLE IF NOT EXISTS wuxia_inventory(scope_id uuid REFERENCES fw_scopes(id),item_id text,quantity integer NOT NULL CHECK(quantity BETWEEN 0 AND 1),PRIMARY KEY(scope_id,item_id));
      CREATE TABLE IF NOT EXISTS wuxia_quests(scope_id uuid REFERENCES fw_scopes(id),quest_id text,status text NOT NULL CHECK(status IN ('not_started','active','completed')),PRIMARY KEY(scope_id,quest_id));
      CREATE TABLE IF NOT EXISTS wuxia_skills(scope_id uuid REFERENCES fw_scopes(id),skill_id text,level integer NOT NULL CHECK(level BETWEEN 1 AND 3),PRIMARY KEY(scope_id,skill_id));
      CREATE TABLE IF NOT EXISTS wuxia_school_quests(scope_id uuid PRIMARY KEY REFERENCES fw_scopes(id),school_id text NOT NULL,status text NOT NULL CHECK(status IN ('active','ready')),cycle integer NOT NULL,enemy_hp integer NOT NULL CHECK(enemy_hp BETWEEN 0 AND 12));
      CREATE TABLE IF NOT EXISTS wuxia_school_quest_history(scope_id uuid REFERENCES fw_scopes(id),cycle integer NOT NULL,PRIMARY KEY(scope_id,cycle));
      CREATE TABLE IF NOT EXISTS wuxia_social_messages(id uuid PRIMARY KEY,sender_scope_id uuid REFERENCES fw_scopes(id),channel text NOT NULL CHECK(channel IN ('say','tell','chat')),recipient_scope_id uuid REFERENCES fw_scopes(id),room_id text,body text NOT NULL,created_at bigint NOT NULL,request_id uuid NOT NULL,UNIQUE(sender_scope_id,request_id));
      CREATE TABLE IF NOT EXISTS wuxia_social_receipts(message_id uuid REFERENCES wuxia_social_messages(id) ON DELETE CASCADE,scope_id uuid REFERENCES fw_scopes(id),PRIMARY KEY(message_id,scope_id));
      CREATE TABLE IF NOT EXISTS wuxia_parties(id uuid PRIMARY KEY,created_at bigint NOT NULL);
      CREATE TABLE IF NOT EXISTS wuxia_party_members(party_id uuid REFERENCES wuxia_parties(id) ON DELETE CASCADE,scope_id uuid UNIQUE REFERENCES fw_scopes(id),joined_at bigint NOT NULL,PRIMARY KEY(party_id,scope_id));
      CREATE TABLE IF NOT EXISTS wuxia_party_invites(id uuid PRIMARY KEY,inviter_scope_id uuid REFERENCES fw_scopes(id),invitee_scope_id uuid REFERENCES fw_scopes(id),status text NOT NULL CHECK(status IN ('pending','accepted','expired')),expires_at bigint NOT NULL,created_at bigint NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS wuxia_one_pending_invite ON wuxia_party_invites(inviter_scope_id,invitee_scope_id) WHERE status='pending';
      CREATE TABLE IF NOT EXISTS wuxia_social_writes(scope_id uuid REFERENCES fw_scopes(id),request_id uuid,request_hash text NOT NULL,response jsonb NOT NULL,PRIMARY KEY(scope_id,request_id));
      UPDATE wuxia_characters SET current_room_id=COALESCE(current_room_id,'gate'),world_content_version=COALESCE(world_content_version,'1'),player_name=COALESCE(player_name,'少侠-'||left(scope_id::text,4)),school_id=COALESCE(school_id,CASE WHEN master IS NOT NULL THEN 'qingsong' END);
      INSERT INTO wuxia_discovered_rooms SELECT scope_id,current_room_id FROM wuxia_characters ON CONFLICT DO NOTHING;
      INSERT INTO wuxia_quests SELECT scope_id,'medicine','not_started' FROM wuxia_characters ON CONFLICT DO NOTHING;
      INSERT INTO wuxia_skills SELECT scope_id,'breathing',1 FROM wuxia_characters WHERE school_id='qingsong' ON CONFLICT DO NOTHING;`);
    // Legacy NPC rows are read only after migration. New characters use the shared realm NPCs.
    for (const npc of world.npcs) await tx.query('INSERT INTO wuxia_npc_states(scope_id,npc_id,room_id) SELECT scope_id,$1,$2 FROM wuxia_characters WHERE NOT EXISTS(SELECT 1 FROM mud_npcs WHERE realm_id=$3 AND npc_id=$1) ON CONFLICT DO NOTHING', [npc.id, npc.roomId, realmId]);
    await tx.query(`INSERT INTO mud_characters(scope_id,realm_id,name,room_id,active)
      SELECT c.scope_id,$1,c.player_name,c.current_room_id,NOT EXISTS(SELECT 1 FROM fw_game_resets r WHERE r.old_scope_id=c.scope_id)
      FROM wuxia_characters c ON CONFLICT DO NOTHING`, [realmId]);
    for (const npc of world.npcs) {
      const prior = (await tx.query('SELECT 1 FROM mud_npcs WHERE realm_id=$1 AND npc_id=$2',[realmId,npc.id])).rowCount;
      if (!prior) {
        const variants = (await tx.query('SELECT DISTINCT room_id,status FROM wuxia_npc_states WHERE npc_id=$1',[npc.id])).rows;
        if (variants.length>1) throw new Error(`NPC_MIGRATION_CONFLICT:${JSON.stringify({npcId:npc.id,variants})}`);
        await tx.query('INSERT INTO mud_npcs(realm_id,npc_id,room_id,status) VALUES($1,$2,$3,$4)',[realmId,npc.id,variants[0]?.room_id??npc.roomId,variants[0]?.status??'present']);
      }
    }
    await tx.query(`CREATE TABLE IF NOT EXISTS qingxi_migrations(version text PRIMARY KEY)`);
    if (!(await tx.query("SELECT 1 FROM qingxi_migrations WHERE version='mud-1'")).rowCount) {
      await tx.query(`INSERT INTO mud_messages(id,realm_id,sender,channel,recipient,body,created_at)
        SELECT id,$1,sender_scope_id,channel,recipient_scope_id,body,created_at FROM wuxia_social_messages ON CONFLICT DO NOTHING`,[realmId]);
      await tx.query('INSERT INTO mud_receipts SELECT message_id,scope_id FROM wuxia_social_receipts ON CONFLICT DO NOTHING');
      await tx.query('INSERT INTO mud_writes(scope_id,request_id,hash,result) SELECT scope_id,request_id,request_hash,response FROM wuxia_social_writes ON CONFLICT DO NOTHING');
      await tx.query('INSERT INTO mud_parties(id,realm_id) SELECT id,$1 FROM wuxia_parties ON CONFLICT DO NOTHING',[realmId]);
      await tx.query('INSERT INTO mud_members SELECT m.scope_id,m.party_id FROM wuxia_party_members m JOIN mud_characters c ON c.scope_id=m.scope_id WHERE c.active ON CONFLICT DO NOTHING');
      await tx.query(`INSERT INTO mud_invites SELECT id,$1,inviter_scope_id,invitee_scope_id,expires_at,status FROM wuxia_party_invites ON CONFLICT DO NOTHING`,[realmId]);
      await tx.query("UPDATE mud_parties SET active=false WHERE id NOT IN (SELECT party_id FROM mud_members GROUP BY party_id HAVING count(*)>=2)");
      await tx.query('DELETE FROM mud_members WHERE party_id IN (SELECT id FROM mud_parties WHERE NOT active)');
      await tx.query("INSERT INTO qingxi_migrations VALUES('mud-1')");
    }
    if ((await tx.query('SELECT 1 FROM wuxia_characters WHERE world_content_version<>$1 LIMIT 1', [world.version])).rowCount) throw new Error('Unsupported world content version');
  });
}
export function publicState(row: any) {
  return { silver: row.silver, virtue: row.virtue, skill: row.skill, master: row.master, encounterDone: row.encounter_done, hostVersion: row.host_version,
    name: row.player_name, gender: row.gender, hp: row.hp, maxHp: 30, qi: row.qi, maxQi: 10, experience: row.experience, potential: row.potential, schoolId: row.school_id };
}
export async function initializeGame(store: PostgresStore, tx: Transaction, id: string) {
  const row = (await tx.query("INSERT INTO wuxia_characters(scope_id,access_hash,current_room_id,world_content_version,player_name,last_active_at) VALUES($1,'account-managed','gate',$2,$4,$3) RETURNING *", [id, world.version, Date.now(),`少侠-${id.slice(0,4)}`])).rows[0];
  await tx.query("INSERT INTO mud_characters(scope_id,realm_id,name,room_id) VALUES($1,$2,$3,'gate')", [id,realmId,row.player_name]);
  await tx.query("INSERT INTO wuxia_discovered_rooms VALUES($1,'gate')", [id]);
  await tx.query("INSERT INTO wuxia_quests VALUES($1,'medicine','not_started')", [id]);
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
  if (action.startsWith('escort_') && row.current_room_id !== (action === 'escort_contribute' ? 'forest' : 'herbalist')) return 'TARGET_NOT_PRESENT';
  const target = targets[action] ?? (action === 'talk' ? input.targetId : undefined);
  if (target && (!s.npcs.some(n => n.npc_id === target && n.status === 'present') || (input.targetId && input.targetId !== target))) return 'TARGET_NOT_PRESENT';
  if (action === 'move') {
    const exit = world.exits.find(e => e.id === input.exitId && e.from === row.current_room_id);
    if (!exit) return 'NOT_ADJACENT';
    if (exit.requirement === 'master' && !row.master) return 'EXIT_LOCKED';
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
  if (action === 'set_profile' && (!input.name?.trim() || input.name.trim().length > 12 || !['男','女','未设定'].includes(input.gender ?? ''))) return 'INVALID_PROFILE';
  if (action === 'join_school') {
    const school = schools[input.schoolId as keyof typeof schools];
    if (!school) return 'INVALID_SCHOOL';
    if (row.school_id) return 'ALREADY_APPRENTICED';
    if (row.current_room_id !== school.roomId) return 'TARGET_NOT_PRESENT';
  }
  if (action === 'learn_skill') {
    return trainingDenial(row, s.skills, input.skillId ?? '')?.code ?? null;
  }
  if (['accept_school_quest','turn_in_school_quest'].includes(action)) {
    const school = schools[input.schoolId as keyof typeof schools];
    if (!school || row.school_id !== input.schoolId) return 'INVALID_SCHOOL';
    if (row.current_room_id !== school.roomId) return 'TARGET_NOT_PRESENT';
    if (action === 'accept_school_quest' && s.schoolQuest) return 'QUEST_ALREADY_ACTIVE';
    if (action === 'turn_in_school_quest' && s.schoolQuest?.status !== 'ready') return 'QUEST_NOT_READY';
  }
  if (['attack','use_skill'].includes(action)) {
    if (input.enemyId !== 'bandit' || row.current_room_id !== 'trail' || s.schoolQuest?.status !== 'active') return 'TARGET_NOT_PRESENT';
    if (action === 'use_skill') {
      const school = schools[row.school_id as keyof typeof schools];
      if (!school || input.skillId !== school.advanced || !s.skills.some(x => x.skill_id === input.skillId)) return 'INVALID_SKILL';
      if (row.qi < 2) return 'INSUFFICIENT_QI';
    }
  }
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
    lockResources: (tx, scopeId) => lockRealm(tx, scopeId),
    id: `wuxia.${action}`, version: '1', mode: ai ? 'assessment' : 'recordMemory', inputSchema: inputSchema(action), ...(ai ? { outputSchema } : {}),
    async prepare(raw, scopeId) {
      const input = raw as Input;
      return store.transaction(async tx => {
        const {realm} = await lockRealm(tx, scopeId);
        await tx.query('SELECT id FROM fw_scopes WHERE id=$1 FOR SHARE', [scopeId]);
        const s = await readWorldState(tx, scopeId); check(action, input, s);
        const target = targets[action] ?? input.targetId; const scene = makeScene(s);
        const open = action === 'encounter' && s.row.good_deed_item_id
          ? (await tx.query("SELECT id FROM fw_memory WHERE scope_id=$1 AND id=$2 AND status='open'", [scopeId, s.row.good_deed_item_id])).rows.map(r => r.id) : [];
        return {
          gameVersion: `${s.row.host_version}:${realm.revision}`,
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
      const {realm} = await lockRealm(tx, context.scopeId);
      if (`${row.host_version}:${realm.revision}` !== context.gameVersion) throw new HarnessError('STATE_CONFLICT');
      check(action, input, s);
      const before = publicState(row); const choice = (proposal as any)?.choice;
      const eventId = randomUUID(); const memoryChanges: MemoryChange[] = []; let message = '';
      if (action.startsWith('escort_')) {
        const outcome = await sharedTask(tx,context.scopeId,'medicine_escort',action.slice(7) as 'accept'|'contribute'|'complete'|'claim',2);
        if(outcome.awarded) { row.experience += 5; row.potential += 2; }
        message = ({escort_accept:'两人接下护送药箱委托。',escort_contribute:'你勘察了林地药路。',escort_complete:'药箱已安全送达。',escort_claim:'领取护送奖励：经验+5，潜能+2。'} as Record<string,string>)[action];
      } else if (action === 'move') {
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
        if (choice === 'ACCEPT') { row.master = '青松道人'; row.school_id = 'qingsong'; row.skill += 1; await tx.query("INSERT INTO wuxia_skills(scope_id,skill_id,level) VALUES($1,'breathing',1) ON CONFLICT DO NOTHING", [context.scopeId]); message = '青松道人收你为徒，传授入门心法。武学 +1。'; } else message = '青松道人暂缓收徒，邀你继续历练。';
      } else if (action === 'encounter') {
        if (choice === 'GIFT') { row.silver += 4; message = '江湖故人赠你四两银钱，助你远行。'; } else { row.skill += 1; message = '你得到高人指点。武学 +1。'; }
        row.encounter_done = true;
        if (row.good_deed_item_id && (await tx.query("SELECT id FROM fw_memory WHERE scope_id=$1 AND id=$2 AND status='open'", [context.scopeId, row.good_deed_item_id])).rowCount) memoryChanges.push({ op: 'close_item', id: row.good_deed_item_id });
      } else if (action === 'set_profile') {
        row.player_name = input.name!.trim(); row.gender = input.gender; message = `你以“${row.player_name}”之名踏入江湖。`;
      } else if (action === 'join_school') {
        const school = schools[input.schoolId as keyof typeof schools];
        row.school_id = input.schoolId; row.master = school.master;
        await tx.query('INSERT INTO wuxia_skills(scope_id,skill_id,level) VALUES($1,$2,1) ON CONFLICT DO NOTHING', [context.scopeId, school.basic]);
        message = `你拜入${school.name}，学会${school.basic === 'breathing' ? '吐纳法' : '采息术'}。`;
      } else if (action === 'learn_skill') {
        row.potential -= 2;
        await tx.query('INSERT INTO wuxia_skills(scope_id,skill_id,level) VALUES($1,$2,1) ON CONFLICT(scope_id,skill_id) DO UPDATE SET level=wuxia_skills.level+1', [context.scopeId, input.skillId]);
        message = `你消耗2点潜能，精进了${input.skillId}。`;
      } else if (action === 'accept_school_quest') {
        const cycle = Number((await tx.query('SELECT COALESCE(MAX(cycle),0)+1 AS cycle FROM wuxia_school_quest_history WHERE scope_id=$1', [context.scopeId])).rows[0].cycle);
        await tx.query("INSERT INTO wuxia_school_quests(scope_id,school_id,status,cycle,enemy_hp) VALUES($1,$2,'active',$3,12)", [context.scopeId, input.schoolId, cycle]);
        message = '师父命你去山道击退拦路恶徒。';
      } else if (action === 'turn_in_school_quest') {
        row.experience += 5; row.potential += 4; row.hp = 30; row.qi = 10;
        await tx.query('INSERT INTO wuxia_school_quest_history(scope_id,cycle) SELECT scope_id,cycle FROM wuxia_school_quests WHERE scope_id=$1', [context.scopeId]);
        await tx.query('DELETE FROM wuxia_school_quests WHERE scope_id=$1', [context.scopeId]);
        message = '师门任务完成。经验 +5，潜能 +4。';
      } else if (action === 'attack' || action === 'use_skill') {
        const advancedLevel = Number(s.skills.find(x => x.skill_id === input.skillId)?.level ?? 0);
        const basic = row.school_id ? schools[row.school_id as keyof typeof schools].basic : '';
        const basicLevel = Number(s.skills.find(x => x.skill_id === basic)?.level ?? 0);
        const damage = action === 'attack' ? Math.max(1, 2 + basicLevel) : Math.max(2, 4 + advancedLevel * 2);
        if (action === 'use_skill') row.qi -= 2;
        const enemyHp = Math.max(0, Number(s.schoolQuest.enemy_hp) - damage);
        if (enemyHp === 0) {
          await tx.query("UPDATE wuxia_school_quests SET enemy_hp=0,status='ready' WHERE scope_id=$1", [context.scopeId]);
          message = `你造成${damage}点伤害，击退恶徒，可以回师门复命。`;
        } else {
          row.hp = Math.max(0, row.hp - 3);
          if (row.hp === 0) {
            row.hp = 30; row.qi = 10; row.silver = Math.max(0, row.silver - 1); row.current_room_id = 'gate';
            await tx.query("UPDATE wuxia_school_quests SET enemy_hp=12 WHERE scope_id=$1", [context.scopeId]);
            message = `你造成${damage}点伤害后力竭，被送回村口并损失一两银钱。`;
          } else {
            await tx.query('UPDATE wuxia_school_quests SET enemy_hp=$2 WHERE scope_id=$1', [context.scopeId, enemyHp]);
            message = `你造成${damage}点伤害，恶徒反击造成3点伤害。`;
          }
        }
      }
      row.host_version += 1;
      await tx.query('UPDATE mud_characters SET room_id=$2,name=$3 WHERE scope_id=$1',[context.scopeId,row.current_room_id,row.player_name]);
      if(action.startsWith('escort_')) await tx.query('UPDATE mud_realms SET revision=revision+1 WHERE id=$1',[realm.id]);
      row.last_active_at = Date.now();
      await tx.query(`UPDATE wuxia_characters SET silver=$2,virtue=$3,skill=$4,master=$5,encounter_done=$6,good_deed_item_id=$7,host_version=$8,current_room_id=$9,player_name=$10,gender=$11,hp=$12,qi=$13,experience=$14,potential=$15,school_id=$16,last_active_at=$17 WHERE scope_id=$1`,
        [context.scopeId, row.silver, row.virtue, row.skill, row.master, row.encounter_done, row.good_deed_item_id, row.host_version, row.current_room_id, row.player_name, row.gender, row.hp, row.qi, row.experience, row.potential, row.school_id, row.last_active_at]);
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
