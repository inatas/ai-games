import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ScriptedModel } from '@game-ai/model';
import { RoomRuntime, type RoomDefinition } from '@game-ai/turn-based';
import { startTestDatabase } from '../support/database.ts';
import { barrier } from '../support/counter.ts';
import { interruptGame } from '../support/interrupt-game.ts';

let db: Awaited<ReturnType<typeof startTestDatabase>>;
const runtimes: RoomRuntime[] = [];
before(async () => { db = await startTestDatabase(); await db.store.migrate(); });
after(async () => { await Promise.all(runtimes.map(r => r.close())); await db?.stop(); });
function runtime(model = new ScriptedModel(() => '{"kind":"replace"}'), definition = interruptGame,
  options: ConstructorParameters<typeof RoomRuntime>[3] = {}) {
  const r = new RoomRuntime(db.store, definition, { test: model }, options); runtimes.push(r); return r;
}
async function ready(r: RoomRuntime, limits = {}) {
  await r.migrate(); const room = await r.create(randomUUID(), limits);
  await r.seat(room.id, { seat: 1, name: 'One', modelProfile: 'test' });
  return r.seat(room.id, { seat: 2, name: 'Two', modelProfile: 'test' });
}

test('TB-09/10: independent interrupt supersedes waiting normal output without memory', async () => {
  const gate = barrier();
  const model = new ScriptedModel(async request => {
    if (JSON.stringify(request.outputSchema).includes('choice')) { await gate.wait(); return '{"choice":"A"}'; }
    return '{"kind":"replace"}';
  });
  const r = runtime(model); const room = await ready(r);
  const normal = r.tick(room.id); await gate.ready;
  try {
    await r.tickInterrupt(room.id, 2);
    assert.equal((await r.inspect(room.id)).phaseInstance, 2);
    assert.doesNotMatch(JSON.stringify(await r.spectate(room.id)), /interruptScope|first-seat-secret/);
  } finally { gate.release(); await normal; }
  const current = await r.inspect(room.id);
  assert.equal(current.status, 'running'); assert.deepEqual(current.decisions, []);
  assert.equal((await db.store.memory(room.seats[0].scopeId, ['internal'])).length, 0);
  assert.equal((await db.store.memory(room.seats[1].interruptScopeId, ['internal'])).length, 1);
  assert.doesNotMatch(JSON.stringify(model.calls[1].messages), /first-seat-secret/);
});

test('TB-10/11/14: normal commit wins, stale interrupt failure cannot block or reuse a live scope', async () => {
  const gate = barrier();
  const model = new ScriptedModel(async request => {
    if (JSON.stringify(request.outputSchema).includes('kind')) { await gate.wait(); throw new Error('late provider failure'); }
    return '{"choice":"A"}';
  });
  const r = runtime(model); const room = await ready(r);
  const interrupt = r.tickInterrupt(room.id, 1); await gate.ready;
  try {
    await r.tick(room.id);
    await r.tickInterrupt(room.id, 1);
    assert.equal(model.calls.length, 2);
  } finally { gate.release(); await interrupt; }
  const current = await r.inspect(room.id);
  assert.equal(current.status, 'running'); assert.equal(current.decisions.length, 1);
  assert.equal((await db.store.memory(room.seats[0].interruptScopeId, ['internal'])).length, 0);
});

test('TB-11: competing interrupts linearize once; same lane shares request across workers', async () => {
  const gate = barrier();
  const model = new ScriptedModel(async () => { await gate.wait(); return '{"kind":"replace"}'; });
  const r = runtime(model); const room = await ready(r);
  const first = r.tickInterrupt(room.id, 1); await gate.ready;
  try {
    await runtime(model).tickInterrupt(room.id, 1);
    assert.equal(model.calls.length, 1);
    await runtime().tickInterrupt(room.id, 2);
  } finally { gate.release(); await first; }
  const current = await r.inspect(room.id);
  assert.equal(current.events.filter(e => e.type === 'replacement').length, 1);
  assert.equal(current.status, 'running');
  const count = await db.store.pool.query('SELECT count(*)::int n FROM fw_requests WHERE scope_id=$1', [room.seats[0].interruptScopeId]);
  assert.equal(count.rows[0].n, 1);
});

test('TB-12: interrupt and effective memory roll back together after memory write', async () => {
  const r = runtime(undefined, interruptGame, { harness: { hook: async point => {
    if (point === 'memory') throw new Error('rollback');
  } } });
  const room = await ready(r); await r.tickInterrupt(room.id, 2);
  const current = await r.inspect(room.id);
  assert.equal(current.status, 'blocked'); assert.deepEqual(current.state, room.state);
  assert.deepEqual(current.events, room.events); assert.equal(current.decisionEpoch, 0);
  assert.equal((await db.store.memory(room.seats[1].interruptScopeId, ['internal'])).length, 0);
});

test('TB-13: passes consume budget without events or epoch, abort never reveals', async () => {
  const model = new ScriptedModel(() => '{"kind":"pass"}');
  const r = runtime(model); const room = await ready(r, { maxRequests: 2 });
  await r.tickInterrupt(room.id, 1); await r.tickInterrupt(room.id, 2);
  const current = await r.inspect(room.id);
  assert.deepEqual(current.events, room.events); assert.equal(current.decisionEpoch, 0);
  assert.equal(current.requests, 2);
  await r.tickInterrupt(room.id, 1);
  assert.equal((await r.inspect(room.id)).status, 'aborted');
  assert.equal(model.calls.length, 2);
  assert.doesNotMatch(JSON.stringify(await r.spectate(room.id)), /secret-state|first-seat-secret/);
});

test('TB-14: durable interrupt reservation resumes after restart; expired jobs do not repeat', async () => {
  const r = runtime(); const room = await ready(r);
  const seat = room.seats[1];
  const requestId = randomUUID();
  room.pendingJobs['interrupt:2'] = { lane: 'interrupt:2', requestId, scopeId: seat.interruptScopeId,
    seat: 2, modelProfile: 'test', memoryVersion: 0, phaseInstance: 1, decisionEpoch: 0, facts: { own: 'reserved' } };
  room.requests = 1;
  await db.store.pool.query('UPDATE tb_rooms SET document=$2 WHERE id=$1', [room.id, JSON.stringify(room)]);
  const model = new ScriptedModel(() => '{"kind":"replace"}');
  await runtime(model).tickInterrupt(room.id, 2);
  assert.equal(model.calls[0].requestId, requestId);
  const current = await r.inspect(room.id);
  assert.equal(current.events.filter(e => e.type === 'replacement').length, 1);
  const results = await db.store.pool.query('SELECT status FROM fw_requests WHERE scope_id=$1 AND request_id=$2', [seat.interruptScopeId, requestId]);
  assert.equal(results.rows[0].status, 'committed');
});

test('TB-13/14: scheduler repeats pass during a pending normal call and closes cleanly', async () => {
  const normalGate = barrier();
  let passes = 0;
  const model = new ScriptedModel(async request => {
    if (JSON.stringify(request.outputSchema).includes('choice')) { await normalGate.wait(); return '{"choice":"A"}'; }
    passes++; return '{"kind":"pass"}';
  });
  const r = runtime(model); const room = await ready(r, { maxRequests: 6 });
  const running = r.run(room.id, { interruptIntervalMs: 10 });
  try {
    await normalGate.ready;
    await running;
    assert.ok(passes >= 3);
    assert.equal((await r.inspect(room.id)).status, 'aborted');
  } finally { normalGate.release(); await r.close(); }
});

test('TB-14: superseded reservation cannot claim a scope after a newer request starts', async () => {
  const reserved = barrier();
  let pause = false;
  const store = {
    pool: db.store.pool,
    applyMemory: db.store.applyMemory.bind(db.store), contextMemory: db.store.contextMemory.bind(db.store),
    transaction: async <T>(fn: Parameters<typeof db.store.transaction<T>>[0]) => {
      const value = await db.store.transaction(fn);
      if (pause) { pause = false; await reserved.wait(); }
      return value;
    },
  };
  const model = new ScriptedModel(() => '{"kind":"replace"}');
  const r = new RoomRuntime(store, interruptGame, { test: model }); runtimes.push(r);
  const room = await ready(r);
  pause = true;
  const old = r.tickInterrupt(room.id, 1); await reserved.ready;
  const active = barrier();
  const slow = runtime(new ScriptedModel(async () => { await active.wait(); return '{"kind":"replace"}'; }));
  let fresh: Promise<unknown> | undefined;
  try {
    await runtime().tickInterrupt(room.id, 2);
    fresh = slow.tickInterrupt(room.id, 1); await active.ready;
    reserved.release();
    await old;
    assert.equal(model.calls.length, 0);
  } finally { reserved.release(); active.release(); await Promise.allSettled([old, fresh]); }
  assert.equal((await r.inspect(room.id)).status, 'running');
});

test('TB-14: expired superseded lease recovers without duplicate action or late write', async () => {
  const gate = barrier();
  const r = runtime(new ScriptedModel(async () => { await gate.wait(); return '{"kind":"replace"}'; }));
  const room = await ready(r); const old = r.tickInterrupt(room.id, 1); await gate.ready;
  try {
    const job = (await r.inspect(room.id)).pendingJobs['interrupt:1']!;
    await runtime().tickInterrupt(room.id, 2);
    await db.store.pool.query('UPDATE fw_requests SET lease_expires_at=0 WHERE scope_id=$1 AND request_id=$2', [job.scopeId, job.requestId]);
    await runtime().tickInterrupt(room.id, 1);
  } finally { gate.release(); await old; }
  const current = await r.inspect(room.id);
  assert.equal(current.status, 'running');
  assert.equal(current.events.filter(e => e.type === 'replacement').length, 2);
  assert.equal((await db.store.memory(room.seats[0].interruptScopeId, ['internal'])).length, 1);
});

test('TB-13/14: interrupt network failure is not retried; close blocks late commits', async () => {
  const failedModel = new ScriptedModel(() => { throw new Error('provider failure'); });
  const failed = runtime(failedModel); const first = await ready(failed);
  await failed.tickInterrupt(first.id, 1); await failed.tickInterrupt(first.id, 1);
  assert.equal((await failed.inspect(first.id)).status, 'blocked');
  assert.equal(failedModel.calls.length, 1);
  const gate = barrier();
  const r = runtime(new ScriptedModel(async () => { await gate.wait(); return '{"kind":"replace"}'; }));
  const room = await ready(r); const running = r.tickInterrupt(room.id, 1); await gate.ready;
  try {
    await r.close();
    assert.equal((await r.inspect(room.id)).events.filter(e => e.type === 'replacement').length, 0);
    await assert.rejects(r.tickInterrupt(room.id, 1), /RUNTIME_CLOSED/);
  } finally { gate.release(); await running; }
  assert.equal((await db.store.memory(room.seats[0].interruptScopeId, ['internal'])).length, 0);
});
