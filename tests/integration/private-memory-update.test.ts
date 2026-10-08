import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness, type Binding, type Json } from '@game-ai/core';
import { ScriptedModel } from '@game-ai/model';
import { startTestDatabase } from '../support/database.ts';
import { counterBinding, counterScope, request } from '../support/counter.ts';

let db: Awaited<ReturnType<typeof startTestDatabase>>;
before(async () => { db = await startTestDatabase(); await db.store.migrate(); });
after(async () => { await db?.stop(); });

function binding(): Binding {
  const base = counterBinding(db.store);
  return {
    ...base,
    outputSchema: {
      type: 'object', additionalProperties: false, required: ['decision'],
      properties: { decision: { type: 'string', enum: ['ACCEPT', 'DEFER'] }, private_update: {} },
    },
    privateMemoryUpdate: {
      factKey: 'private-view',
      parseUpdate(proposal: Json, _facts: Json, previous: Json | null): Json | null {
        const raw = (proposal as { private_update?: unknown }).private_update;
        return raw && typeof raw === 'object' && !Array.isArray(raw) &&
          typeof (raw as { view?: unknown }).view === 'string'
          ? { view: (raw as { view: string }).view, prior: previous } : null;
      },
    },
  };
}

async function run(scopeId: string, memoryVersion: number, response: string) {
  const model = new ScriptedModel(() => response);
  const harness = new Harness(db.store, model).register(binding());
  const input = request(scopeId, memoryVersion);
  await harness.submit(input); await harness.drain();
  return { input, model, harness, result: await harness.get(scopeId, input.requestId) };
}

test('PM-01/02: optional update is private and invalid update does not reject a valid main result', async () => {
  const scope = await counterScope(db.store);
  const first = await run(scope, 0, JSON.stringify({ decision: 'ACCEPT', private_update: { view: 'tentative' } }));
  assert.equal(first.result.status, 'committed');
  const second = await run(scope, 1, JSON.stringify({ decision: 'ACCEPT', private_update: 'bad-shape' }));
  assert.equal(second.result.status, 'committed');
  assert.equal(second.model.calls.length, 1);
  const required = second.model.calls[0]!.messages.find(message => message.content.startsWith('REQUIRED_MEMORY:'))!;
  assert.match(required.content, /tentative/);
  assert.equal(second.model.calls[0]!.messages.some(message =>
    message.content.startsWith('SHARED_PUBLIC_FACTS:') && message.content.includes('tentative')), false);
  const fact = (await db.store.pool.query("SELECT payload,visibility FROM fw_memory WHERE scope_id=$1 AND key='private-view'", [scope])).rows[0];
  assert.deepEqual(fact, { payload: { view: 'tentative', prior: null }, visibility: 'internal' });
  const other = await counterScope(db.store);
  const third = await run(other, 0, '{"decision":"DEFER"}');
  assert.equal(third.result.status, 'committed');
  assert.doesNotMatch(third.model.calls[0]!.messages.find(message => message.content.startsWith('REQUIRED_MEMORY:'))!.content, /tentative/);
});

test('PM-03/04: invalid main result and rollback leave no effective private update', async () => {
  const scope = await counterScope(db.store);
  const invalid = await run(scope, 0, '{"decision":"NO","private_update":{"view":"wrong"}}');
  assert.equal(invalid.result.error?.code, 'MODEL_INVALID_OUTPUT');
  assert.equal((await db.store.pool.query("SELECT count(*)::int AS n FROM fw_memory WHERE scope_id=$1 AND key='private-view'", [scope])).rows[0].n, 0);
  const model = new ScriptedModel(() => '{"decision":"ACCEPT","private_update":{"view":"rolled-back"}}');
  const harness = new Harness(db.store, model, { hook: async point => { if (point === 'memory') throw Error('rollback'); } }).register(binding());
  const input = request(scope);
  await harness.submit(input); await harness.drain();
  assert.equal((await harness.get(scope, input.requestId)).error?.code, 'INTERNAL_ERROR');
  assert.equal((await db.store.pool.query("SELECT count(*)::int AS n FROM fw_memory WHERE scope_id=$1 AND key='private-view'", [scope])).rows[0].n, 0);
});
