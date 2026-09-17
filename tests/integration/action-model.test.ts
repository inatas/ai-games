import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Harness } from '@game-ai/core';
import { decisionBinding, narrationBinding } from '@game-ai/game-systems';
import { ScriptedModel } from '@game-ai/model';
import { minimalHost } from '../../mods/minimal/src/host.ts';
import { startTestDatabase } from '../support/database.ts';

test('BT-04/05: model selects allowed action; narration remains non-authoritative', async () => {
  const db = await startTestDatabase();
  let answer = JSON.stringify({ actionId: 'move', params: { exitId: 'east' } });
  const model = new ScriptedModel(() => answer);
  const harness = new Harness(db.store, model);
  try {
    await db.store.migrate(); const host = minimalHost(db.store); await host.migrate();
    const scopeId = await db.store.createScope(); await db.store.transaction(tx => host.initialize(tx, scopeId));
    host.bindings().forEach(b => harness.register(b));
    harness.register(decisionBinding(db.store, { id: 'minimal.decide', choices: [{ actionId: 'move', params: { exitId: 'east' } }], facts: async () => ({ visible: 'entrance' }) }));
    harness.register(narrationBinding(db.store, { id: 'minimal.narrate' }));
    const submit = async (bindingId: string, input: any) => {
      const version = (await db.store.pool.query('SELECT memory_version FROM fw_scopes WHERE id=$1', [scopeId])).rows[0].memory_version;
      const requestId = randomUUID(); await harness.submit({ scopeId, requestId, expectedMemoryVersion: version, bindingId, bindingVersion: '1', input }); await harness.drain();
      return harness.get(scopeId, requestId);
    };
    const decision = await submit('minimal.decide', {});
    assert.equal(decision.status, 'committed');
    assert.equal((await submit('minimal.narrate', { sourceRequestId: decision.requestId })).status, 'rejected', 'a decision is not a committed game outcome');
    assert.equal((await db.store.pool.query('SELECT room_id FROM mud_characters')).rows[0].room_id, 'a');
    const next = (decision.result as any).nextAction;
    const moved = await submit(`minimal.${next.actionId}`, next.params);
    assert.equal(moved.status, 'committed');
    answer = JSON.stringify({ text: 'You enter the hall.' });
    const narration = await submit('minimal.narrate', { sourceRequestId: moved.requestId });
    assert.equal(narration.status, 'committed');
    assert.equal((await db.store.pool.query('SELECT * FROM fw_memory')).rowCount, 0);
    assert.equal((await db.store.pool.query('SELECT * FROM platform_events')).rowCount, 1);
    answer = JSON.stringify({ actionId: 'grant_money', params: { amount: 999 } });
    assert.equal((await submit('minimal.decide', {})).status, 'rejected');
    answer = 'invalid narration';
    assert.equal((await submit('minimal.narrate', { sourceRequestId: moved.requestId })).status, 'rejected');
    assert.equal((await harness.get(scopeId, moved.requestId)).status, 'committed');
    assert.equal((await db.store.pool.query('SELECT room_id FROM mud_characters')).rows[0].room_id, 'b');
  } finally { await harness.close(); await db.stop(); }
});
