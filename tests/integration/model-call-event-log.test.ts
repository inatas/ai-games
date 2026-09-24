import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Harness } from '@game-ai/core';
import { ScriptedModel } from '@game-ai/model';
import { startTestDatabase } from '../support/database.ts';
import { counterBinding, counterScope, request } from '../support/counter.ts';

let db: Awaited<ReturnType<typeof startTestDatabase>>;
before(async () => { db = await startTestDatabase(); await db.store.migrate(); });
after(async () => { await db?.stop(); });

test('EL-M01/M02/M03: each adapter attempt records its exact request and result', async () => {
  const scope = await counterScope(db.store);
  const userId = randomUUID();
  const model = new ScriptedModel(() => '{"decision":"ACCEPT"}');
  const binding = counterBinding(db.store);
  const prepare = binding.prepare;
  binding.prepare = async (input, id) => ({ ...await prepare(input, id), eventContext: {
    userId, modId: 'neutral', roomId: 'room-42', details: { seatNo: 5, micNo: 1, role: 'test-role' },
  } });
  const harness = new Harness(db.store, model).register(binding);
  const input = request(scope);
  await harness.submit(input); await harness.drain();
  const rows = (await db.store.pool.query('SELECT * FROM fw_event_log WHERE request_id=$1 ORDER BY sequence', [input.requestId])).rows;
  assert.deepEqual(rows.map(row => row.event_type), ['model.call.started.v1', 'model.call.finished.v1', 'model.call.judged.v1']);
  assert.equal(rows[0].user_id, userId);
  assert.equal(rows[0].mod_id, 'neutral');
  assert.equal(rows[0].room_id, 'room-42');
  assert.deepEqual(rows[0].details.modelRequest, model.calls[0]);
  assert.equal(rows[0].details.seatNo, 5);
  assert.equal(rows[0].details.micNo, 1);
  assert.equal(rows[0].details.role, 'test-role');
  assert.equal(rows[1].details.rawText, '{"decision":"ACCEPT"}');
  assert.deepEqual(rows[1].details.usage, { inputTokens: 100, outputTokens: 20 });
  assert.equal(rows[2].result, 'succeeded');
  assert.equal(rows[0].details.simulated, true);
  await harness.submit(input);
  assert.equal((await db.store.pool.query('SELECT count(*)::int AS n FROM fw_event_log WHERE request_id=$1', [input.requestId])).rows[0].n, 3);
});

test('MC-04: finished event preserves provider cache token usage', async () => {
  const scope = await counterScope(db.store);
  const model = { async generate() { return {
    rawText: '{"decision":"ACCEPT"}', model: 'cache-test',
    usage: { inputTokens: 10, outputTokens: 2, promptCacheHitTokens: 7, promptCacheMissTokens: 3 },
  }; } };
  const harness = new Harness(db.store, model).register(counterBinding(db.store));
  const input = request(scope);
  await harness.submit(input); await harness.drain();
  const rows = (await db.store.pool.query(`SELECT details FROM fw_event_log
    WHERE request_id=$1 AND event_type='model.call.finished.v1'`, [input.requestId])).rows;
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].details.usage,
    { inputTokens: 10, outputTokens: 2, promptCacheHitTokens: 7, promptCacheMissTokens: 3 });
});

test('EL-M02/M04/M09: correction and provider failure remain separate attempts without leaking errors', async () => {
  const scope = await counterScope(db.store);
  let calls = 0;
  const model = new ScriptedModel(() => ++calls === 1 ? '{broken' : '{"decision":"ACCEPT"}');
  const harness = new Harness(db.store, model).register(counterBinding(db.store));
  const input = request(scope);
  await harness.submit(input); await harness.drain();
  const rows = (await db.store.pool.query('SELECT event_type,details FROM fw_event_log WHERE request_id=$1 ORDER BY sequence', [input.requestId])).rows;
  assert.deepEqual(rows.filter(row => row.event_type === 'model.call.started.v1').map(row => row.details.attempt), [1, 2]);
  assert.deepEqual(rows.filter(row => row.event_type === 'model.call.finished.v1').map(row => row.details.rawText), ['{broken', '{"decision":"ACCEPT"}']);
  assert.deepEqual(rows.find(row => row.event_type === 'model.call.started.v1' && row.details.attempt === 2).details.modelRequest, model.calls[1]);

  const failedScope = await counterScope(db.store);
  const secret = 'provider-secret-do-not-persist';
  const failed = new Harness(db.store, new ScriptedModel(() => { throw new Error(secret); })).register(counterBinding(db.store));
  const failedInput = request(failedScope);
  await failed.submit(failedInput); await failed.drain();
  const failedRows = (await db.store.pool.query('SELECT * FROM fw_event_log WHERE request_id=$1 ORDER BY sequence', [failedInput.requestId])).rows;
  assert.deepEqual(failedRows.map(row => row.event_type), ['model.call.started.v1', 'model.call.failed.v1']);
  assert.equal(failedRows[1].details.errorCode, 'MODEL_UNAVAILABLE');
  assert.ok(!JSON.stringify(failedRows).includes(secret));
});

test('EL-M08: recovery marks a persisted started attempt orphaned without inventing a result', async () => {
  const scope = await counterScope(db.store);
  const input = request(scope);
  const model = new ScriptedModel(() => '{"decision":"ACCEPT"}');
  const harness = new Harness(db.store, model).register(counterBinding(db.store));
  await db.store.pool.query(`INSERT INTO fw_requests
    (scope_id,request_id,hash,binding_id,binding_version,mode,status,lease_expires_at,input)
    VALUES($1,$2,'test','counter','1','assessment','processing',0,'{}')`, [scope, input.requestId]);
  await db.store.pool.query(`INSERT INTO fw_event_log
    (event_id,event_type,occurred_at,request_id,result,details)
    VALUES($1,'model.call.started.v1',now(),$2,'started',$3)`,
    [randomUUID(), input.requestId, JSON.stringify({ scopeId: scope, attempt: 1 })]);
  await harness.recover();
  await harness.recover();
  const rows = (await db.store.pool.query('SELECT event_type,result,details FROM fw_event_log WHERE request_id=$1 ORDER BY sequence',
    [input.requestId])).rows;
  assert.deepEqual(rows.map(row => row.event_type), ['model.call.started.v1', 'model.call.orphaned.v1']);
  assert.equal(rows[1].details.attempt, 1);
  assert.equal(rows[1].result, 'unknown');
  assert.equal(model.calls.length, 0);
});

test('EL-M07: an unavailable event log prevents the adapter call', async () => {
  const scope = await counterScope(db.store);
  const model = new ScriptedModel(() => '{"decision":"ACCEPT"}');
  const harness = new Harness(db.store, model).register(counterBinding(db.store));
  await db.store.pool.query('REVOKE INSERT ON fw_event_log FROM PUBLIC');
  // The test role owns the table, so a local transaction trigger models a storage rejection.
  await db.store.pool.query(`CREATE FUNCTION reject_event_log() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'event log unavailable'; END $$`);
  await db.store.pool.query(`CREATE TRIGGER reject_event_log_insert BEFORE INSERT ON fw_event_log
    FOR EACH ROW EXECUTE FUNCTION reject_event_log()`);
  try {
    await harness.submit(request(scope)); await harness.drain();
    assert.equal(model.calls.length, 0);
  } finally {
    await db.store.pool.query('DROP TRIGGER reject_event_log_insert ON fw_event_log');
    await db.store.pool.query('DROP FUNCTION reject_event_log()');
  }
});

test('EL-M02: context budget rejection records no model attempt', async () => {
  const scope = await counterScope(db.store);
  const model = new ScriptedModel(() => '{"decision":"ACCEPT"}');
  const harness = new Harness(db.store, model, { inputBudget: 1 }).register(counterBinding(db.store));
  const input = request(scope);
  await harness.submit(input); await harness.drain();
  const rows = (await db.store.pool.query('SELECT event_type,result,details FROM fw_event_log WHERE request_id=$1',
    [input.requestId])).rows;
  assert.deepEqual(rows.map(row => row.event_type), ['model.context_rejected.v1']);
  assert.equal(rows[0].details.errorCode, 'CONTEXT_TOO_LARGE');
  assert.equal(model.calls.length, 0);
});

test('EL-M04: oversized provider text is explicitly marked incomplete', async () => {
  const scope = await counterScope(db.store);
  const model = new ScriptedModel(() => 'x'.repeat(70_000));
  const harness = new Harness(db.store, model).register(counterBinding(db.store));
  const input = request(scope);
  await harness.submit(input); await harness.drain();
  const rows = (await db.store.pool.query(`SELECT details FROM fw_event_log
    WHERE request_id=$1 AND event_type='model.call.finished.v1' ORDER BY sequence`, [input.requestId])).rows;
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.details.rawText, null);
    assert.equal(row.details.rawTextBytes, 70_000);
    assert.equal(row.details.rawTextComplete, false);
    assert.match(row.details.rawTextDigest, /^[a-f0-9]{64}$/);
  }
});
