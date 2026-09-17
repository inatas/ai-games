import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '@game-ai/core';
import { createActionEvents, decisionBinding, NpcScheduler, RuleRegistry, type BehaviorDefinition } from '@game-ai/game-systems';
import { randomUUID } from 'node:crypto';
import { minimalHost } from '../../mods/minimal/src/host.ts';
import { startTestDatabase } from '../support/database.ts';

test('BT-02/03/06: concurrent wakeups and restart preserve exactly one NPC movement', async () => {
  const db = await startTestDatabase();
  const harness = new Harness(db.store, { async generate(): Promise<never> { throw Error('deterministic patrol needs no model'); } });
  let now = 1000;
  try {
    await db.store.migrate();
    const host = minimalHost(db.store); await host.migrate();
    host.bindings().forEach(binding => harness.register(binding));
    const tree: BehaviorDefinition = { id: 'patrol', npcId: 'guide', intervalMs: 1000, root: { type: 'sequence', children: [
      { type: 'action', actionId: 'move', params: { exitId: 'east' } },
      { type: 'action', actionId: 'move', params: { exitId: 'west' } },
    ] } };
    const make = () => new NpcScheduler(db.store, harness, { realmId: 'minimal', contentVersion: '1', bindings: { move: 'minimal.move' }, rules: new RuleRegistry(), facts: async () => ({}), now: () => now });
    let scheduler = make(); await scheduler.initialize([tree]);
    const submit = harness.submit.bind(harness);
    harness.submit = async () => { throw Error('stopped before submission'); };
    await assert.rejects(scheduler.tick(), /stopped before submission/);
    harness.submit = submit;
    scheduler = make(); await scheduler.initialize([tree]);
    await Promise.all([scheduler.tick(), scheduler.tick()]); await harness.drain();
    assert.equal((await db.store.pool.query('SELECT room_id FROM mud_npcs')).rows[0].room_id, 'b');
    assert.equal((await db.store.pool.query('SELECT * FROM platform_events')).rowCount, 1);
    scheduler = make(); await scheduler.initialize([tree]);
    await scheduler.tick(); now += 1001;
    await Promise.all([scheduler.tick(), scheduler.tick()]); await harness.drain();
    assert.equal((await db.store.pool.query('SELECT room_id FROM mud_npcs')).rows[0].room_id, 'a');
    assert.equal((await db.store.pool.query('SELECT * FROM platform_events')).rowCount, 2);
    await scheduler.tick(); now += 100000;
    await scheduler.tick(); await harness.drain();
    assert.equal((await db.store.pool.query('SELECT * FROM platform_events')).rowCount, 2, 'completed cycle resets without catching up missed ticks');
    const state = (await db.store.pool.query('SELECT cursor,pending FROM game_npc_behaviors')).rows[0];
    assert.equal(state.pending, null);
    assert.deepEqual(state.cursor, {});
  } finally { await harness.close(); await db.stop(); }
});

test('BT-04/05: NPC model choice becomes one independently committed action', async () => {
  const db = await startTestDatabase();
  let calls = 0;
  const harness = new Harness(db.store, { async generate() { calls++; return { rawText: '{"actionId":"move","params":{"exitId":"east"}}', model: 'test', usage: null }; } });
  try {
    await db.store.migrate(); const host = minimalHost(db.store); await host.migrate(); host.bindings().forEach(b => harness.register(b));
    await db.store.pool.query("INSERT INTO mud_npcs VALUES('minimal','thinker','a','present',0)");
    harness.register(decisionBinding(db.store, { id: 'minimal.decide', choices: [{ actionId: 'move', params: { exitId: 'east' } }], facts: async () => ({}) }));
    const scheduler = new NpcScheduler(db.store, harness, { realmId: 'minimal', contentVersion: '1', bindings: { decide: 'minimal.decide', move: 'minimal.move' }, rules: new RuleRegistry(), facts: async () => ({}), now: () => 1000 });
    await scheduler.initialize([{ id: 'think', npcId: 'thinker', intervalMs: 1000, root: { type: 'action', actionId: 'decide', params: {} } }]);
    await scheduler.tick(); await harness.drain();
    assert.equal((await db.store.pool.query("SELECT room_id FROM mud_npcs WHERE npc_id='thinker'")).rows[0].room_id, 'a');
    await Promise.all([scheduler.tick(), scheduler.tick()]); await harness.drain();
    assert.equal((await db.store.pool.query("SELECT room_id FROM mud_npcs WHERE npc_id='thinker'")).rows[0].room_id, 'b');
    assert.equal(calls, 1);
    assert.equal((await db.store.pool.query("SELECT * FROM fw_requests WHERE status='committed'")).rowCount, 2);
    assert.equal((await db.store.pool.query('SELECT * FROM platform_events')).rowCount, 1);
  } finally { await harness.close(); await db.stop(); }
});

test('BT-04: failed model decision is terminal until a new external wakeup', async () => {
  const db = await startTestDatabase();
  let now = 1000, calls = 0;
  const harness = new Harness(db.store, { async generate(): Promise<never> { calls++; throw Error('network unavailable'); } });
  try {
    await db.store.migrate(); const host = minimalHost(db.store); await host.migrate();
    await db.store.pool.query("INSERT INTO mud_npcs VALUES('minimal','thinker','a','present',0)");
    harness.register(decisionBinding(db.store, { id: 'minimal.decide', choices: [{ actionId: 'move', params: { exitId: 'east' } }], facts: async () => ({}) }));
    const scheduler = new NpcScheduler(db.store, harness, { realmId: 'minimal', contentVersion: '1', bindings: { decide: 'minimal.decide', move: 'minimal.move' }, rules: new RuleRegistry(), facts: async () => ({}), now: () => now });
    await scheduler.initialize([{ id: 'think', npcId: 'thinker', intervalMs: 1000, root: { type: 'action', actionId: 'decide', params: {} } }]);
    for (let i = 0; i < 6; i++) { await scheduler.tick(); await harness.drain(); now += 10000; }
    assert.equal(calls, 1);
    assert.equal((await db.store.pool.query("SELECT last_error FROM game_npc_behaviors WHERE npc_id='thinker'")).rows[0].last_error, 'MODEL_UNAVAILABLE');
  } finally { await harness.close(); await db.stop(); }
});

test('EV-03/BT-05: event wakeup snapshots audience and propagates causation once', async () => {
  const db = await startTestDatabase();
  const harness = new Harness(db.store, { async generate(): Promise<never> { throw Error('unexpected model'); } });
  try {
    await db.store.migrate(); const host = minimalHost(db.store); await host.migrate(); host.bindings().forEach(b => harness.register(b));
    const actor = await db.store.createScope(); await db.store.transaction(tx => host.initialize(tx, actor));
    const scheduler = new NpcScheduler(db.store, harness, { realmId: 'minimal', contentVersion: '1', bindings: { move: 'minimal.move' }, rules: new RuleRegistry(), facts: async () => ({}), now: () => 1000 });
    await scheduler.initialize([{ id: 'react', npcId: 'guide', intervalMs: 1000, root: { type: 'action', actionId: 'move', params: { exitId: 'east' } } }]);
    await db.store.pool.query('UPDATE game_npc_behaviors SET next_wake_at=999999');
    const events = createActionEvents(db.store); events.registerConsumer(scheduler.consumer());
    const eventId = randomUUID();
    await db.store.transaction(tx => events.append(tx, { eventId, realmId: 'minimal', type: 'actor.moved', actor: { kind: 'character', id: actor }, requestId: randomUUID(), causationId: null, chainDepth: 0, contentVersion: '1', payload: { from: 'a', to: 'b', exitId: 'east' }, createdAt: 1000 }, [{ consumerId: 'npc.wake', recipient: { kind: 'npc', id: 'guide' } }]));
    await events.tick(); await events.tick(); await scheduler.tick(); await harness.drain();
    const children = (await db.store.pool.query('SELECT chain_depth FROM platform_events WHERE causation_id=$1', [eventId])).rows;
    assert.deepEqual(children, [{ chain_depth: 1 }]);
  } finally { await harness.close(); await db.stop(); }
});
