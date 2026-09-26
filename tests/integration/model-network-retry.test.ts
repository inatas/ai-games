import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness, HarnessError, NetworkRetryGate } from '@game-ai/core';
import { startTestDatabase } from '../support/database.ts';
import { counterBinding, counterScope, request } from '../support/counter.ts';

let db: Awaited<ReturnType<typeof startTestDatabase>>;
before(async () => { db = await startTestDatabase(); await db.store.migrate(); });
after(async () => { await db?.stop(); });

const success = { rawText: '{"decision":"ACCEPT"}', model: 'test', usage: { inputTokens: 10, outputTokens: 2 } };
const network = () => new HarnessError('MODEL_UNAVAILABLE', 503, undefined, { transportCategory: 'network' });
const retry = (gate = new NetworkRetryGate({ maxConcurrentRetries: 2, failureWindowMs: 10000, failureThreshold: 3, openMs: 15000 })) => ({
  maxAttempts: 3, delaysMs: [20, 30] as [number, number], jitterMs: 0,
  minRemainingMs: 10, commitReserveMs: 5, key: 'test-profile', gate,
});

test('MR-01/02: two separated network retries can commit the third response once', async () => {
  const scope = await counterScope(db.store);
  const times: number[] = [];
  const harness = new Harness(db.store, { async generate() {
    times.push(Date.now());
    if (times.length < 3) throw network();
    return success;
  } }, { networkRetry: retry() }).register(counterBinding(db.store));
  const input = request(scope);
  await harness.submit(input); await harness.drain();
  assert.equal((await harness.get(scope, input.requestId)).status, 'committed');
  assert.equal(times.length, 3);
  assert.ok(times[1] - times[0] >= 20);
  assert.ok(times[2] - times[1] >= 30);
  const events = (await db.store.pool.query('SELECT event_type,details FROM fw_event_log WHERE request_id=$1 ORDER BY sequence', [input.requestId])).rows;
  assert.deepEqual(events.filter(event => event.event_type === 'model.call.started.v1').map(event => event.details.attempt), [1, 2, 3]);
  assert.deepEqual(events.filter(event => event.event_type === 'model.call.failed.v1').map(event => event.details.attempt), [1, 2]);
  assert.deepEqual(events.filter(event => event.event_type === 'model.call.finished.v1').map(event => event.details.attempt), [3]);
  assert.equal(events.filter(event => event.event_type === 'model.call.judged.v1' && event.details.gameCommitted).length, 1);
});

test('MR-03/06: three network failures stop at three calls and do not invent usage', async () => {
  const scope = await counterScope(db.store);
  let calls = 0;
  const harness = new Harness(db.store, { async generate(): Promise<never> { calls++; throw network(); } },
    { networkRetry: retry() }).register(counterBinding(db.store));
  const input = request(scope);
  await harness.submit(input); await harness.drain();
  assert.equal(calls, 3);
  assert.equal((await harness.get(scope, input.requestId)).error?.code, 'MODEL_UNAVAILABLE');
  const rows = (await db.store.pool.query('SELECT event_type,details FROM fw_event_log WHERE request_id=$1 ORDER BY sequence', [input.requestId])).rows;
  assert.equal(rows.filter(row => row.event_type === 'model.call.finished.v1').length, 0);
  assert.deepEqual(rows.filter(row => row.event_type === 'model.call.failed.v1').map(row => row.details.attempt), [1, 2, 3]);
});

test('MR-03/04: format repair shares the three-call cap and HTTP errors never retry', async () => {
  const scope = await counterScope(db.store);
  let calls = 0;
  const harness = new Harness(db.store, { async generate() {
    calls++;
    if (calls === 1) return { ...success, rawText: '{broken' };
    throw network();
  } }, { networkRetry: retry() }).register(counterBinding(db.store));
  const input = request(scope);
  await harness.submit(input); await harness.drain();
  assert.equal(calls, 3);
  assert.equal((await harness.get(scope, input.requestId)).error?.code, 'MODEL_UNAVAILABLE');

  const otherScope = await counterScope(db.store);
  let httpCalls = 0;
  const httpHarness = new Harness(db.store, { async generate(): Promise<never> {
    httpCalls++;
    throw new HarnessError('MODEL_UNAVAILABLE', 503, undefined, { transportCategory: 'http', httpStatus: 503 });
  } }, { networkRetry: retry() }).register(counterBinding(db.store));
  const otherInput = request(otherScope);
  await httpHarness.submit(otherInput); await httpHarness.drain();
  assert.equal(httpCalls, 1);
});

test('MR-04: original deadline prevents a delayed retry', async () => {
  const scope = await counterScope(db.store);
  let calls = 0;
  const harness = new Harness(db.store, { async generate(): Promise<never> { calls++; throw network(); } },
    { networkRetry: { ...retry(), delaysMs: [100, 30] } }).register(counterBinding(db.store));
  const input = { ...request(scope), notAfter: Date.now() + 80 };
  await harness.submit(input); await harness.drain();
  assert.equal(calls, 1);
  assert.equal((await harness.get(scope, input.requestId)).status, 'failed');
});

test('MR-05: an open circuit skips a new HTTP call without a started event', async () => {
  const gate = new NetworkRetryGate({
    maxConcurrentRetries: 2, failureWindowMs: 10000, failureThreshold: 3, openMs: 15000,
  });
  const firstScope = await counterScope(db.store);
  let calls = 0;
  const model = { async generate(): Promise<never> { calls++; throw network(); } };
  const first = new Harness(db.store, model, { networkRetry: retry(gate) }).register(counterBinding(db.store));
  const firstInput = request(firstScope);
  await first.submit(firstInput); await first.drain();
  assert.equal(calls, 3);

  const secondScope = await counterScope(db.store);
  const second = new Harness(db.store, model, { networkRetry: retry(gate) }).register(counterBinding(db.store));
  const secondInput = request(secondScope);
  await second.submit(secondInput); await second.drain();
  assert.equal(calls, 3);
  const rows = (await db.store.pool.query('SELECT event_type FROM fw_event_log WHERE request_id=$1 ORDER BY sequence',
    [secondInput.requestId])).rows;
  assert.deepEqual(rows.map(row => row.event_type), ['model.call.skipped.v1']);
});
