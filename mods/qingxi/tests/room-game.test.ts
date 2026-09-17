import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ScriptedModel } from '@game-ai/model';
import { Harness } from '@game-ai/core';
import { updateNpc } from '@game-ai/game-systems';
import { startTestDatabase } from '../../../tests/support/database.ts';
import { buildApp } from '../../../apps/server/src/app.ts';
import { migrateGame, gameBinding } from '../src/game.ts';

let db: Awaited<ReturnType<typeof startTestDatabase>>;
let built: Awaited<ReturnType<typeof buildApp>>;
let override: string | null = null;
const model = new ScriptedModel(r => {
  if (override) return override;
  const p = (r.outputSchema as any).properties;
  return p.answerId ? JSON.stringify({ answerId: p.answerId.enum[0] }) : JSON.stringify({ choice: p.choice.enum[0] });
});
before(async () => { db = await startTestDatabase(); built = await buildApp(db.store, model); });
after(async () => { await built?.app.close(); await db?.stop(); });
async function login() {
  const r = await built.app.inject({ method: 'POST', url: '/api/auth/login', headers: { origin: 'http://localhost' }, payload: { username: `room_${randomUUID().slice(0,8)}`, password: 'room-test-password' } });
  assert.equal(r.statusCode, 200, r.body);
  return { id: r.json().currentScopeId as string, cookie: String(r.headers['set-cookie']).split(';')[0] };
}
type Session = Awaited<ReturnType<typeof login>>;
async function read(g: Session) {
  const r = await built.app.inject({ url: `/api/mud/current`, headers: { cookie: g.cookie } });
  assert.equal(r.statusCode, 200, r.body); return r.json();
}
async function act(g: Session, action: string, extra: Record<string, string> = {}, requestId = randomUUID()) {
  const version = (await read(g)).memoryVersion;
  const r = await built.app.inject({ method: 'POST', url: `/api/mud/actions`, headers: { cookie: g.cookie, origin: 'http://localhost' }, payload: { requestId, expectedMemoryVersion: version, action, note: '', ...extra } });
  assert.ok([200,202].includes(r.statusCode), r.body);
  await built.harness.drain(); return built.harness.get(g.id, requestId);
}
async function move(g: Session, to: string) {
  const current = (await read(g)).map.currentRoomId;
  const result = await act(g, 'move', { exitId: `${current}:${to}` });
  assert.equal(result.status, 'committed', JSON.stringify(result));
}
test('WM-02/04/05/06/07/22: room exploration, quest, growth and atomic unlock', async () => {
  const g = await login(); const calls = model.calls.length;
  assert.equal((await read(g)).map.currentRoomId, 'gate');
  assert.equal((await act(g, 'talk', { targetId: 'herbalist', topicId: 'news' })).error?.detail, 'TARGET_NOT_PRESENT');
  assert.equal((await act(g, 'move', { exitId: 'gate:stream' })).error?.detail, 'NOT_ADJACENT');
  assert.equal((await act(g, 'encounter')).error?.detail, 'TARGET_NOT_PRESENT');
  await move(g, 'street'); await move(g, 'herbalist');
  await act(g, 'accept_quest', { targetId: 'herbalist', questId: 'medicine' });
  await move(g, 'square'); await move(g, 'trail'); await move(g, 'forest');
  assert.ok((await read(g)).scene.objects.some((o: any) => o.id === 'medicine'));
  const pickup = randomUUID(); await act(g, 'pickup', { itemId: 'medicine' }, pickup);
  assert.equal((await read(g)).inventory[0].quantity, 1);
  assert.equal((await act(g, 'pickup', { itemId: 'medicine' })).error?.detail, 'ITEM_NOT_AVAILABLE');
  assert.ok(!(await read(g)).scene.objects.some((o: any) => o.id === 'medicine'));
  await move(g, 'trail'); await move(g, 'square'); await move(g, 'herbalist');
  assert.equal((await act(g, 'give', { targetId: 'herbalist', questId: 'medicine', itemId: 'medicine' })).status, 'committed');
  assert.equal((await act(g, 'give', { targetId: 'herbalist', questId: 'medicine', itemId: 'medicine' })).error?.detail, 'QUEST_COMPLETED');
  await move(g, 'square'); await act(g, 'good_deed'); await act(g, 'good_deed');
  await move(g, 'dojo'); await move(g, 'dojo-yard');
  assert.equal((await act(g, 'move', { exitId: 'dojo-yard:inner' })).error?.detail, 'EXIT_LOCKED');
  await move(g, 'dojo'); await act(g, 'apprenticeship'); await move(g, 'dojo-yard');
  assert.equal((await read(g)).map.edges.find((e: any) => e.to === 'inner').access, 'open');
  await act(g, 'challenge');
  const final = await read(g);
  assert.equal(final.state.silver, 21); assert.equal(final.state.virtue, 2); assert.equal(final.state.skill, 2);
  assert.equal(final.quests[0].status, 'completed'); assert.equal(final.inventory.length, 0);
  assert.equal(model.calls.length - calls, 1);
  await move(g, 'inner');
});

test('WM-09/10/12/19: current context, topic restrictions and idempotency', async () => {
  const g = await login(); await move(g, 'street'); await move(g, 'herbalist'); await move(g, 'square');
  await act(g, 'good_deed');
  await db.store.transaction(tx => db.store.applyMemory(tx, g.id, [{ op: 'append_event', id: randomUUID(), payload: 'unrelated_waiter_history', subjectIds: ['player','waiter'], tags: ['npc:waiter'] }]));
  const id = randomUUID(); const version = (await read(g)).memoryVersion;
  const first = await act(g, 'talk', { targetId: 'villager', topicId: 'news' }, id);
  assert.equal(first.status, 'committed');
  const text = model.calls.at(-1)!.messages.map(m => m.content).join('\n');
  assert.match(text, /广场/); assert.match(text, /村民/); assert.match(text, /good_deed/);
  assert.ok(!text.includes('店小二'));
  assert.ok(!text.includes('unrelated_waiter_history'));
  const replay = await built.app.inject({ method: 'POST', url: `/api/mud/actions`, headers: { cookie: g.cookie, origin: 'http://localhost' }, payload: { requestId: id, expectedMemoryVersion: version, action: 'talk', note: '', targetId: 'villager', topicId: 'news' } });
  assert.deepEqual(replay.json(), first);
  assert.equal((await act(g, 'talk', { targetId: 'villager', topicId: 'secret' })).error?.detail, 'INVALID_TOPIC');
  const before = await read(g);
  try { override = '{"answerId":"invented","silver":999}'; assert.equal((await act(g, 'talk', { targetId: 'villager', topicId: 'news' })).error?.code, 'MODEL_INVALID_OUTPUT'); }
  finally { override = null; }
  assert.equal((await read(g)).memoryVersion, before.memoryVersion);
});

test('WM-14: initialization preserves attributes and history, migration is repeatable', async () => {
  const g = await login();
  await db.store.pool.query("UPDATE wuxia_characters SET silver=37,master='青松道人',encounter_done=true WHERE scope_id=$1", [g.id]);
  await migrateGame(db.store); await migrateGame(db.store);
  const state = await read(g);
  assert.equal(state.map.currentRoomId, 'gate'); assert.equal(state.state.silver, 37);
  assert.equal(state.state.master, '青松道人'); assert.equal(state.state.encounterDone, true); assert.equal(state.memoryVersion, 0);
  await move(g, 'street'); await migrateGame(db.store);
  assert.equal((await read(g)).map.currentRoomId, 'street');
});

test('MF-05/11: a public NPC move invalidates an in-flight AI judgment for every player', async () => {
  const first = await login();
  const second = await login();
  await move(first, 'street'); await move(first, 'herbalist'); await move(first, 'square');
  await move(second, 'street'); await move(second, 'herbalist'); await move(second, 'square');
  assert.ok((await read(second)).scene.objects.some((object: any) => object.id === 'villager'));

  let started!: () => void;
  let release!: () => void;
  const modelStarted = new Promise<void>(resolve => { started = resolve; });
  const mayFinish = new Promise<void>(resolve => { release = resolve; });
  const waiting = new Harness(db.store, {
    async generate() {
      started();
      await mayFinish;
      return { rawText: '{"answerId":"GUIDE"}', model: 'scripted', usage: null };
    },
  });
  waiting.register(gameBinding(db.store, 'talk'));
  try {
    const requestId = randomUUID();
    const before = await read(first);
    await waiting.submit({ scopeId: first.id, requestId, expectedMemoryVersion: before.memoryVersion,
      bindingId: 'wuxia.talk', bindingVersion: '1', input: { note: '', targetId: 'villager', topicId: 'news' } });
    await modelStarted;
    await db.store.transaction(tx => updateNpc(tx, 'qingxi', 'villager', 'stream', 'present'));
    await migrateGame(db.store);
    assert.equal((await db.store.pool.query("SELECT room_id FROM mud_npcs WHERE realm_id='qingxi' AND npc_id='villager'")).rows[0].room_id, 'stream');
    assert.ok(!(await read(second)).scene.objects.some((object: any) => object.id === 'villager'));
    release();
    await waiting.drain();
    const result = await waiting.get(first.id, requestId);
    assert.equal(result.status, 'failed');
    assert.equal(result.error?.code, 'STATE_CONFLICT');
    assert.equal((await read(first)).memoryVersion, before.memoryVersion);
  } finally {
    release();
    await waiting.close();
    await db.store.transaction(tx => updateNpc(tx, 'qingxi', 'villager', 'square', 'present'));
  }
});

test('WM-11: quest writes roll back on failure; model timeout leaves no game event', async () => {
  const g = await login(); await move(g, 'street'); await move(g, 'herbalist');
  const before = await read(g);
  const broken = new Harness(db.store, model, { hook: async point => { if (point === 'host') throw new Error('Injected persistence failure'); } });
  broken.register(gameBinding(db.store, 'accept_quest'));
  const id = randomUUID();
  await broken.submit({ scopeId: g.id, requestId: id, expectedMemoryVersion: before.memoryVersion, bindingId: 'wuxia.accept_quest', bindingVersion: '1', input: { note: '', targetId: 'herbalist', questId: 'medicine' } });
  await broken.drain(); assert.equal((await broken.get(g.id,id)).status, 'failed'); await broken.close();
  assert.deepEqual(await read(g), before);
  const timeout = new Harness(db.store, { generate: async () => new Promise(() => {}) }, { callTimeoutMs: 15 });
  timeout.register(gameBinding(db.store, 'talk')); const timeoutId = randomUUID();
  await timeout.submit({ scopeId: g.id, requestId: timeoutId, expectedMemoryVersion: before.memoryVersion, bindingId: 'wuxia.talk', bindingVersion: '1', input: { note: '', targetId: 'herbalist', topicId: 'news' } });
  await timeout.drain(); assert.equal((await timeout.get(g.id,timeoutId)).error?.code, 'MODEL_TIMEOUT'); await timeout.close();
  assert.deepEqual(await read(g), before);
});

test('WM-11/13: stale actor state rejected, persistent world isolated and reset', async () => {
  const g = await login(); await move(g, 'street'); await move(g, 'tea');
  const before = await read(g);
  const changed = new ScriptedModel(async () => {
    await db.store.pool.query('UPDATE wuxia_characters SET host_version=host_version+1 WHERE scope_id=$1', [g.id]);
    return '{"answerId":"GUIDE"}';
  });
  const h = new Harness(db.store, changed); h.register(gameBinding(db.store,'talk')); const id = randomUUID();
  await h.submit({ scopeId:g.id,requestId:id,expectedMemoryVersion:before.memoryVersion,bindingId:'wuxia.talk',bindingVersion:'1',input:{note:'',targetId:'waiter',topicId:'news'} });
  await h.drain(); assert.equal((await h.get(g.id,id)).error?.code,'STATE_CONFLICT'); await h.close();
  const other = await login();
  assert.equal((await read(other)).id, other.id);
  assert.notEqual((await read(other)).id, g.id);
  assert.equal((await built.app.inject({url:`/api/mud/requests/${id}`,headers:{cookie:other.cookie}})).statusCode,404);
  assert.equal((await built.app.inject({url:`/api/wuxia/games/${g.id}`,headers:{cookie:other.cookie}})).statusCode,404);
  await built.app.close(); built = await buildApp(db.store,model);
  assert.equal((await read(g)).map.currentRoomId,'tea');
  const reset=await built.app.inject({method:'POST',url:'/api/game/current/reset',headers:{cookie:g.cookie,origin:'http://localhost'},payload:{requestId:randomUUID(),expectedCurrentScopeId:g.id}});
  assert.equal(reset.statusCode,200,reset.body);
  assert.equal((await read({...g,id:reset.json().currentScopeId})).map.currentRoomId,'gate');
  assert.equal((await built.app.inject({url:`/api/mud/requests/${id}`,headers:{cookie:g.cookie}})).statusCode,404);
  assert.equal((await built.app.inject({url:`/api/wuxia/games/${g.id}`,headers:{cookie:g.cookie}})).statusCode,404);
});

test('WM-12: reject extra fields and keep target changes in idempotency identity',async()=>{
  const g=await login(); const headers={cookie:g.cookie,origin:'http://localhost'};
  const payload={requestId:randomUUID(),expectedMemoryVersion:0,action:'move',note:'',exitId:'gate:street'};
  assert.equal((await built.app.inject({method:'POST',url:`/api/mud/actions`,headers,payload:{...payload,itemId:'medicine'}})).statusCode,400);
  assert.equal((await built.app.inject({method:'POST',url:`/api/mud/actions`,headers,payload:{...payload,silver:999}})).statusCode,400);
  await built.app.inject({method:'POST',url:`/api/mud/actions`,headers,payload}); await built.harness.drain();
  const conflict=await built.app.inject({method:'POST',url:`/api/mud/actions`,headers,payload:{...payload,exitId:'street:tea'}});
  assert.equal(conflict.statusCode,409); assert.equal(conflict.json().code,'IDEMPOTENCY_CONFLICT');
});

test('WM-18: one-way shortcut cannot be traversed backwards', async () => {
  const g = await login();
  await move(g, 'street'); await move(g, 'tea'); await move(g, 'tea-yard'); await move(g, 'street');
  const version = (await read(g)).memoryVersion;
  assert.equal((await act(g, 'move', { exitId: 'street:tea-yard' })).error?.detail, 'NOT_ADJACENT');
  assert.equal((await read(g)).memoryVersion, version);
});
