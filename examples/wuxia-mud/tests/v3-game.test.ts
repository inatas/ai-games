import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ScriptedModel } from '@game-ai/model';
import { startTestDatabase } from '../../../tests/support/database.ts';
import { buildApp } from '../../../apps/server/src/app.ts';

let db: Awaited<ReturnType<typeof startTestDatabase>>;
let built: Awaited<ReturnType<typeof buildApp>>;
before(async () => { db = await startTestDatabase(); built = await buildApp(db.store, new ScriptedModel(() => '{"choice":"ACCEPT"}')); });
after(async () => { await built?.app.close(); await db?.stop(); });

async function login() {
  const response = await built.app.inject({ method: 'POST', url: '/api/auth/login', headers: { origin: 'http://localhost' }, payload: { username: `v3_${randomUUID().slice(0,8)}`, password: 'v3-test-password' } });
  assert.equal(response.statusCode, 200, response.body);
  return { id: response.json().currentScopeId as string, cookie: String(response.headers['set-cookie']).split(';')[0] };
}
type Session = Awaited<ReturnType<typeof login>>;
async function read(g: Session) { const response = await built.app.inject({ url: `/api/wuxia/games/${g.id}`, headers: { cookie: g.cookie } }); assert.equal(response.statusCode, 200, response.body); return response.json(); }
async function act(g: Session, action: string, extra: Record<string,string> = {}, requestId = randomUUID()) {
  const version = (await read(g)).memoryVersion;
  const response = await built.app.inject({ method: 'POST', url: `/api/wuxia/games/${g.id}/actions`, headers: { cookie: g.cookie, origin: 'http://localhost' }, payload: { requestId, expectedMemoryVersion: version, action, note: '', ...extra } });
  assert.ok([200,202].includes(response.statusCode), response.body); await built.harness.drain(); return built.harness.get(g.id, requestId);
}
async function move(g: Session, to: string) { const from = (await read(g)).map.currentRoomId; const result = await act(g, 'move', { exitId: `${from}:${to}` }); assert.equal(result.status, 'committed', JSON.stringify(result)); }

test('CG-01/02/03/04/05/07: profile, school, quest, combat and skills persist atomically', async () => {
  const g = await login();
  assert.equal((await act(g, 'set_profile', { name: '林清', gender: '女' })).status, 'committed');
  await move(g, 'street'); await move(g, 'herbalist'); await move(g, 'square'); await move(g, 'dojo');
  assert.equal((await act(g, 'join_school', { schoolId: 'qingsong' })).status, 'committed');
  assert.equal((await act(g, 'join_school', { schoolId: 'baicao' })).error?.detail, 'ALREADY_APPRENTICED');
  assert.equal((await act(g, 'accept_school_quest', { schoolId: 'qingsong' })).status, 'committed');
  await move(g, 'square'); await move(g, 'trail');
  const firstId = randomUUID();
  assert.equal((await act(g, 'attack', { enemyId: 'bandit' }, firstId)).status, 'committed');
  const afterFirst = await read(g); assert.equal(afterFirst.schoolQuest.enemyHp, 9); assert.equal(afterFirst.state.hp, 27);
  for (let i=0;i<3;i++) assert.equal((await act(g, 'attack', { enemyId: 'bandit' })).status, 'committed');
  assert.equal((await read(g)).schoolQuest.status, 'ready');
  await move(g, 'square'); await move(g, 'dojo');
  assert.equal((await act(g, 'turn_in_school_quest', { schoolId: 'qingsong' })).status, 'committed');
  assert.equal((await act(g, 'learn_skill', { skillId: 'breathing' })).status, 'committed');
  assert.equal((await act(g, 'learn_skill', { skillId: 'qingsong_sword' })).status, 'committed');
  const state = await read(g);
  assert.equal(state.state.name, '林清'); assert.equal(state.state.gender, '女'); assert.equal(state.state.experience, 5); assert.equal(state.state.potential, 0);
  assert.deepEqual(state.skills, [{ skillId: 'breathing', level: 2 }, { skillId: 'qingsong_sword', level: 1 }]);
  await act(g, 'accept_school_quest', { schoolId: 'qingsong' }); await move(g, 'square'); await move(g, 'trail');
  await act(g, 'use_skill', { enemyId: 'bandit', skillId: 'qingsong_sword' });
  assert.equal((await read(g)).schoolQuest.enemyHp, 6); assert.equal((await read(g)).state.qi, 8);
});

test('CG-06: defeat restores the player without negative silver and resets the enemy', async () => {
  const g = await login(); await move(g, 'street'); await move(g, 'herbalist'); await move(g, 'square'); await move(g, 'dojo');
  await act(g, 'join_school', { schoolId: 'qingsong' }); await act(g, 'accept_school_quest', { schoolId: 'qingsong' }); await move(g, 'square'); await move(g, 'trail');
  await db.store.pool.query('UPDATE wuxia_characters SET hp=3,silver=0 WHERE scope_id=$1', [g.id]);
  await act(g, 'attack', { enemyId: 'bandit' }); const state = await read(g);
  assert.equal(state.state.hp, 30); assert.equal(state.state.qi, 10); assert.equal(state.state.silver, 0); assert.equal(state.map.currentRoomId, 'gate'); assert.equal(state.schoolQuest.enemyHp, 12);
});

test('SR-01/04/05/07/09/10: room visibility, message privacy and party idempotency', async () => {
  const a = await login(); const b = await login(); const c = await login();
  await act(a, 'set_profile', { name: '阿青', gender: '女' }); await act(b, 'set_profile', { name: '无名', gender: '男' }); await move(c, 'street');
  assert.ok((await read(a)).playersHere.some((p: any) => p.scopeId === b.id));
  async function post(g: Session, path: string, payload: Record<string,unknown>) { return built.app.inject({ method: 'POST', url: `/api/wuxia/games/${g.id}/social/${path}`, headers: { cookie: g.cookie, origin: 'http://localhost' }, payload }); }
  const sayId = randomUUID(); assert.equal((await post(a, 'messages', { requestId: sayId, channel: 'say', body: '诸位好。' })).statusCode, 200);
  const conflict = await post(a, 'messages', { requestId: sayId, channel: 'say', body: '不会重复' }); assert.equal(conflict.statusCode, 409); assert.equal(conflict.json().code, 'IDEMPOTENCY_CONFLICT');
  assert.ok((await read(b)).messages.some((m: any) => m.body === '诸位好。'));
  await move(c, 'gate');
  assert.ok(!(await read(c)).messages.some((m: any) => m.body === '诸位好。'));
  assert.equal((await post(a, 'messages', { requestId: randomUUID(), channel: 'tell', body: '密语', targetScopeId: b.id })).statusCode, 200);
  assert.ok((await read(b)).messages.some((m: any) => m.body === '密语'));
  assert.ok(!(await read(c)).messages.some((m: any) => m.body === '密语'));
  const invite = (await post(a, 'party', { requestId: randomUUID(), action: 'invite', targetScopeId: b.id })).json();
  const acceptId = randomUUID(); const accepted = await post(b, 'party', { requestId: acceptId, action: 'accept', inviteId: invite.inviteId }); assert.equal(accepted.statusCode, 200, accepted.body);
  const replay = await post(b, 'party', { requestId: acceptId, action: 'accept', inviteId: invite.inviteId }); assert.deepEqual(replay.json(), accepted.json());
  assert.equal((await read(a)).party.members.length, 2);
  assert.equal((await post(b, 'party', { requestId: randomUUID(), action: 'leave' })).statusCode, 200);
  assert.equal((await read(a)).party, null);
});
