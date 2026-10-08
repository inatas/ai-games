import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ScriptedModel } from '@game-ai/model';
import { RoomRuntime, migrateTurnBased, type RoomDefinition } from '@game-ai/turn-based';
import { startTestDatabase } from '../support/database.ts';
import { barrier } from '../support/counter.ts';
import { choiceGame } from '../support/turn-based.ts';

let db: Awaited<ReturnType<typeof startTestDatabase>>;
const runtimes: RoomRuntime[] = [];
before(async () => {
  db = await startTestDatabase();
  await db.store.migrate();
  await db.store.transaction(migrateTurnBased);
});
after(async () => { await Promise.all(runtimes.map(r => r.close())); await db?.stop(); });
function runtime(model = new ScriptedModel(() => '{"choice":"A"}'), definition = choiceGame,
  options: ConstructorParameters<typeof RoomRuntime>[3] = {}) {
  const r = new RoomRuntime(db.store, definition, { first: model, second: model }, options);
  runtimes.push(r);
  return { r, model };
}
async function ready(r: RoomRuntime, key = randomUUID(), limits = {}) {
  const room = await r.create(key, limits);
  await r.seat(room.id, { seat: 1, name: 'First', modelProfile: 'first' });
  return r.seat(room.id, { seat: 2, name: 'Second', modelProfile: 'second' });
}

test('TB-01/08: independent migration, idempotent seats, no MUD schema or fake accounts', async () => {
  const { r } = runtime(); await r.migrate(); await r.migrate();
  const key = randomUUID();
  const empty = await r.create(key);
  assert.equal(empty.status, 'waiting');
  assert.equal((await r.create(key)).id, empty.id);
  await assert.rejects(r.create(key, { maxPhases: 1 }), /IDEMPOTENCY_CONFLICT/);
  await assert.rejects(r.seat(empty.id, { seat: 1, name: 'X', modelProfile: 'unknown' }), /UNKNOWN_MODEL/);
  await assert.rejects(r.seat(empty.id, { seat: 3, name: 'X', modelProfile: 'first' }), /INVALID_SEAT/);
  const first = await r.seat(empty.id, { seat: 1, name: 'First', modelProfile: 'first' });
  assert.equal(first.status, 'waiting');
  assert.deepEqual(await r.seat(empty.id, { seat: 1, name: 'First', modelProfile: 'first' }), first);
  await assert.rejects(r.seat(empty.id, { seat: 1, name: 'Changed', modelProfile: 'first' }), /SEAT_CONFLICT/);
  const room = await r.seat(empty.id, { seat: 2, name: 'Second', modelProfile: 'second' });
  assert.equal(room.status, 'running');
  assert.notEqual(room.seats[0].scopeId, room.seats[1].scopeId);
  const tables = await db.store.pool.query("SELECT tablename FROM pg_tables WHERE schemaname=current_schema() AND tablename LIKE 'mud_%'");
  assert.equal(tables.rows.length, 0);
  assert.equal((await db.store.pool.query('SELECT count(*)::int n FROM fw_users')).rows[0].n, 0);
});

test('TB-03/04/07: actual model requests isolated and finished spectator alone gets replay', async () => {
  const { r, model } = runtime(); const room = await ready(r);
  await r.tick(room.id);
  assert.doesNotMatch(JSON.stringify(await r.spectate(room.id)), /secret|choice.*A|scopeId/);
  await r.tick(room.id);
  assert.equal(model.calls.length, 2);
  assert.match(JSON.stringify(model.calls[0].messages), /first-seat-secret/);
  assert.doesNotMatch(JSON.stringify(model.calls[1].messages), /first-seat-secret|secret-state|\\"choice\\":\\"A\\"/);
  const ended = await r.spectate(room.id);
  assert.equal(ended.status, 'finished');
  assert.match(JSON.stringify(ended), /first-seat-secret|secret-state/);
  await r.tick(room.id);
  assert.equal(model.calls.length, 2);
  const memories = await db.store.pool.query('SELECT scope_id,payload FROM fw_memory WHERE scope_id=ANY($1::uuid[])', [room.seats.map(s => s.scopeId)]);
  assert.equal(memories.rows.length, 2);
  assert.equal(new Set(memories.rows.map(r => r.scope_id)).size, 2);
});

test('TB-05: competing workers share a durable request and restart continues next seat', async () => {
  const gate = barrier();
  const model = new ScriptedModel(async () => { await gate.wait(); return '{"choice":"A"}'; });
  const { r } = runtime(model); const room = await ready(r);
  const a = r.tick(room.id); await gate.ready;
  const other = runtime(model).r;
  try { await other.tick(room.id); assert.equal(model.calls.length, 1); }
  finally { gate.release(); }
  await a;
  assert.equal((await r.inspect(room.id)).decisions.length, 1);
  const restarted = runtime().r;
  await restarted.tick(room.id);
  assert.equal((await restarted.inspect(room.id)).status, 'finished');
});

test('TB-06: model failure blocks without facts or memory; explicit resume creates a new attempt', async () => {
  let fail = true;
  const { r, model } = runtime(new ScriptedModel(() => { if (fail) throw new Error('provider secret'); return '{"choice":"A"}'; }));
  const room = await ready(r); await r.tick(room.id);
  const failed = await r.inspect(room.id);
  assert.equal(failed.status, 'blocked');
  assert.equal(failed.decisions.length, 0);
  assert.equal(failed.events.length, room.events.length);
  assert.equal((await db.store.memory(room.seats[0].scopeId, ['internal'])).length, 0);
  assert.doesNotMatch(JSON.stringify(await r.spectate(room.id)), /secret-state|provider secret/);
  await r.tick(room.id); assert.equal(model.calls.length, 1);
  fail = false; await r.resume(room.id); await r.tick(room.id);
  assert.equal((await r.inspect(room.id)).decisions.length, 1);
});

test('TB-06: resolver failure rolls back final decision, events, state, and memory', async () => {
  const def: RoomDefinition = { ...choiceGame, id: 'rollback', resolve: () => { throw new Error('settlement failure'); } };
  const { r } = runtime(undefined, def); const room = await ready(r);
  await r.tick(room.id); const before = await r.inspect(room.id);
  await r.tick(room.id); const failed = await r.inspect(room.id);
  assert.equal(failed.status, 'blocked');
  assert.deepEqual(failed.decisions, before.decisions);
  assert.deepEqual(failed.events, before.events);
  assert.deepEqual(failed.state, before.state);
  assert.equal((await db.store.memory(room.seats[1].scopeId, ['internal'])).length, 0);
});

test('TB-06/07: strict outputs repair once; timeout and illegal actions never become decisions', async () => {
  for (const [script, code] of [
    [() => '{"choice":"A","extra":true}', 'MODEL_INVALID_OUTPUT'],
    [() => '{"choice":"B"}', 'RULE_REJECTED'],
    [() => new Promise<string>(() => {}), 'MODEL_TIMEOUT'],
  ] as const) {
    const { r, model } = runtime(new ScriptedModel(script), choiceGame, { harness: { callTimeoutMs: 50 } });
    const room = await ready(r); await r.tick(room.id);
    const failed = await r.inspect(room.id);
    assert.equal(failed.status, 'blocked'); assert.equal(failed.error, code);
    assert.equal(failed.decisions.length, 0);
    assert.equal(model.calls.length, code === 'MODEL_INVALID_OUTPUT' ? 2 : 1);
  }
});

test('TB-07: request budget and version mismatch fail closed', async () => {
  const { r } = runtime(); const room = await ready(r, randomUUID(), { maxRequests: 1 });
  await r.tick(room.id); await r.tick(room.id);
  assert.equal((await r.inspect(room.id)).status, 'aborted');
  assert.doesNotMatch(JSON.stringify(await r.spectate(room.id)), /secret/);
  const changed = runtime(undefined, { ...choiceGame, version: '2' }).r;
  await assert.rejects(changed.tick(room.id), /DEFINITION_MISMATCH/);
});

test('TB-05/06: unsubmitted reservations recover; expired executions cannot commit late', async () => {
  const gate = barrier();
  const slow = new ScriptedModel(async () => { await gate.wait(); return '{"choice":"A"}'; });
  const { r } = runtime(slow);
  const room = await ready(r);
  const executing = r.tick(room.id); await gate.ready;
  const pending = (await r.inspect(room.id)).pendingJobs['normal:1']!;
  try {
    await db.store.pool.query('UPDATE fw_requests SET lease_expires_at=0 WHERE scope_id=$1 AND request_id=$2', [pending.scopeId, pending.requestId]);
    await runtime().r.tick(room.id);
  } finally { gate.release(); }
  await executing;
  const blocked = await r.inspect(room.id);
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.error, 'PROCESSING_EXPIRED');
  assert.deepEqual(blocked.decisions, []);
  assert.equal((await db.store.memory(pending.scopeId, ['internal'])).length, 0);

  const { r: recovery, model } = runtime();
  const fresh = await ready(recovery);
  // Simulate a crash after durable reservation but before Harness submission.
  const job = {
    lane: 'normal:1' as const, decisionEpoch: 0, requestId: randomUUID(), scopeId: fresh.seats[0].scopeId, seat: 1,
    modelProfile: 'first', memoryVersion: 0, phaseInstance: 1, facts: { ownClue: 'reserved-private' },
  };
  fresh.pendingJobs['normal:1'] = job; fresh.requests = 1;
  await db.store.pool.query('UPDATE tb_rooms SET document=$2 WHERE id=$1', [fresh.id, JSON.stringify(fresh)]);
  await recovery.tick(fresh.id);
  assert.equal(model.calls.length, 1);
  assert.equal(model.calls[0].requestId, job.requestId);
  assert.equal((await recovery.inspect(fresh.id)).decisions.length, 1);
});

test('TB-06: phase changed during model wait rejects stale output without memory', async () => {
  const gate = barrier();
  const { r } = runtime(new ScriptedModel(async () => { await gate.wait(); return '{"choice":"A"}'; }));
  const room = await ready(r);
  const executing = r.tick(room.id); await gate.ready;
  try {
    await db.store.pool.query("UPDATE tb_rooms SET document=jsonb_set(document,'{phaseInstance}','2') WHERE id=$1", [room.id]);
  } finally { gate.release(); }
  await executing;
  const final = await r.inspect(room.id);
  assert.equal(final.status, 'running'); assert.equal(final.error, null);
  assert.deepEqual(final.decisions, []);
  assert.equal((await db.store.memory(room.seats[0].scopeId, ['internal'])).length, 0);
});

test('TB-05/07: profile routing and rooms remain independent while another model waits', async () => {
  const gate = barrier();
  const slow = new ScriptedModel(async () => { await gate.wait(); return '{"choice":"A"}'; });
  const fast = new ScriptedModel(() => '{"choice":"A"}');
  const r = new RoomRuntime(db.store, choiceGame, { slow, fast }); runtimes.push(r);
  const a = await r.create(randomUUID()); const b = await r.create(randomUUID());
  for (const [room, profile] of [[a, 'slow'], [b, 'fast']] as const) {
    await r.seat(room.id, { seat: 1, name: 'One', modelProfile: profile });
    await r.seat(room.id, { seat: 2, name: 'Two', modelProfile: 'fast' });
  }
  const waiting = r.tick(a.id); await gate.ready;
  try { await r.tick(b.id); await r.tick(b.id); assert.equal((await r.inspect(b.id)).status, 'finished'); }
  finally { gate.release(); }
  await waiting; await r.tick(a.id);
  assert.equal(slow.calls.length, 1); assert.equal(fast.calls.length, 3);
});

test('TB-07: phase budget abort retains diagnostic and never reveals secrets', async () => {
  const def: RoomDefinition = { ...choiceGame, id: 'loop', resolve: (state, phase) => ({ state, phase }) };
  const { r } = runtime(undefined, def);
  const room = await ready(r, randomUUID(), { maxPhases: 1 });
  await r.tick(room.id); await r.tick(room.id);
  const ended = await r.inspect(room.id);
  assert.equal(ended.status, 'aborted');
  assert.equal(ended.error, 'PHASE_BUDGET_EXCEEDED');
  assert.doesNotMatch(JSON.stringify(await r.spectate(room.id)), /secret/);
});

test('TB-06: failure after game and memory writes rolls both back', async () => {
  const { r } = runtime(undefined, choiceGame, { harness: {
    hook: async point => { if (point === 'memory') throw new Error('injected commit failure'); },
  } });
  const room = await ready(r); await r.tick(room.id);
  const failed = await r.inspect(room.id);
  assert.equal(failed.status, 'blocked');
  assert.deepEqual(failed.events, room.events);
  assert.deepEqual(failed.decisions, []);
  assert.deepEqual(failed.state, room.state);
  const memory = await db.store.memory(room.seats[0].scopeId, ['internal']);
  assert.equal(memory.length, 0);
  const scope = await db.store.pool.query('SELECT memory_version FROM fw_scopes WHERE id=$1', [room.seats[0].scopeId]);
  assert.equal(scope.rows[0].memory_version, 0);
});

test('TB-01/07: twelve independent seats complete a sealed phase without a fixed two-seat assumption', async () => {
  const def: RoomDefinition = { ...choiceGame, id: 'twelve', seats: 12, initialize: seats => {
    const initial = choiceGame.initialize(seats);
    initial.phase.actors = seats.map(s => s.seat);
    return initial;
  } };
  const models = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`profile-${i + 1}`, new ScriptedModel(() => '{"choice":"A"}')]));
  const r = new RoomRuntime(db.store, def, models); runtimes.push(r);
  let room = await r.create(randomUUID());
  for (let seat = 1; seat <= 12; seat++) room = await r.seat(room.id, { seat, name: `AI ${seat}`, modelProfile: `profile-${seat}` });
  assert.equal(new Set(room.seats.map(s => s.scopeId)).size, 12);
  for (let seat = 1; seat <= 12; seat++) await r.tick(room.id);
  assert.equal((await r.spectate(room.id)).status, 'finished');
  for (const model of Object.values(models)) assert.equal(model.calls.length, 1);
});

test('TB-06: close waits for scheduler completion and leaves no late game or memory commit', async () => {
  const gate = barrier();
  const { r } = runtime(new ScriptedModel(async () => { await gate.wait(); return '{"choice":"A"}'; }));
  const room = await ready(r);
  const executing = r.tick(room.id); await gate.ready;
  try {
    await r.close();
    const current = await r.inspect(room.id);
    assert.equal(current.status, 'blocked');
    assert.equal(current.decisions.length, 0);
    await assert.rejects(r.tick(room.id), /RUNTIME_CLOSED/);
  } finally { gate.release(); await executing; }
});

test('TB-06: shutdown during reservation waits for tick and never starts a late model call', async () => {
  const gate = barrier();
  let holdReservation = false;
  const store = {
    pool: db.store.pool,
    applyMemory: db.store.applyMemory.bind(db.store),
    contextMemory: db.store.contextMemory.bind(db.store),
    internalFact: db.store.internalFact.bind(db.store),
    transaction: async <T>(fn: Parameters<typeof db.store.transaction<T>>[0]) => {
      const result = await db.store.transaction(fn);
      if (holdReservation) { holdReservation = false; await gate.wait(); }
      return result;
    },
  };
  const model = new ScriptedModel(() => '{"choice":"A"}');
  const r = new RoomRuntime(store, choiceGame, { first: model, second: model }); runtimes.push(r);
  const room = await ready(r);
  holdReservation = true;
  const ticking = r.tick(room.id).catch(error => error);
  await gate.ready;
  let closed = false;
  const closing = r.close().then(() => { closed = true; });
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(closed, false);
  } finally { gate.release(); await ticking; await closing; }
  assert.equal(model.calls.length, 0);
});
