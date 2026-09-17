import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Harness } from '@game-ai/core';
import { migratePlatform } from '@game-ai/platform';
import { createActionEvents, moveBinding, initializeNpcActor, migrateGameSystems, type MapDefinition } from '@game-ai/game-systems';
import { startTestDatabase } from '../support/database.ts';

test('AC-01/02/03/05: player and NPC share move, versioning and idempotency', async () => {
  const db = await startTestDatabase();
  const map: MapDefinition = { version: '1', rooms: ['a', 'b'].map((id, x) => ({ id, name: id, description: id, kind: 'street', templateId: 'street', layout: { x, y: 0 } })), exits: [{ id: 'east', from: 'a', to: 'b', direction: 'east' }, { id: 'west', from: 'b', to: 'a', direction: 'west' }] };
  const events = createActionEvents(db.store);
  const harness = new Harness(db.store, { async generate() { throw Error('move must not call model'); } });
  try {
    await db.store.migrate(); await db.store.transaction(migratePlatform); await db.store.transaction(migrateGameSystems);
    const player = await db.store.createScope();
    await db.store.transaction(async tx => {
      await tx.query("INSERT INTO mud_realms VALUES('r','test','1','1','1',0)");
      await tx.query("INSERT INTO mud_characters(scope_id,realm_id,name,room_id) VALUES($1,'r','player','a')", [player]);
      await tx.query("INSERT INTO mud_npcs VALUES('r','guide','a','present',0)");
    });
    const npcScope = await db.store.transaction(tx => initializeNpcActor(tx, 'r', 'guide', ['move']));
    assert.equal(await db.store.transaction(tx => initializeNpcActor(tx, 'r', 'guide', ['move'])), npcScope);
    harness.register(moveBinding(db.store, { id: 'test.move', map, events }));
    for (const scopeId of [player, npcScope]) {
      const input = { scopeId, requestId: randomUUID(), expectedMemoryVersion: 0, bindingId: 'test.move', bindingVersion: '1', input: { exitId: 'east' } };
      await harness.submit(input); await harness.drain();
      assert.equal((await harness.get(scopeId, input.requestId)).status, 'committed');
      assert.equal((await harness.submit(input)).status, 'committed');
      await assert.rejects(harness.submit({ ...input, input: { exitId: 'west' } }), /IDEMPOTENCY_CONFLICT/);
    }
    assert.equal((await db.store.pool.query('SELECT * FROM platform_events')).rowCount, 2);
    assert.equal((await db.store.pool.query('SELECT room_id FROM mud_npcs')).rows[0].room_id, 'b');
    assert.equal((await db.store.pool.query('SELECT * FROM mud_characters WHERE scope_id=$1', [npcScope])).rowCount, 0);
    let allowed = false;
    const gatedMap = structuredClone(map);
    gatedMap.exits[1].conditions = [{ ruleId: 'permit', params: {} }];
    harness.register(moveBinding(db.store, { id: 'test.gated', map: gatedMap, events, denial: async () => allowed ? null : 'LOCKED' }));
    for (const scopeId of [player, npcScope]) {
      const requestId = randomUUID();
      await harness.submit({ scopeId, requestId, expectedMemoryVersion: 1, bindingId: 'test.gated', bindingVersion: '1', input: { exitId: 'west' } }); await harness.drain();
      assert.equal((await harness.get(scopeId, requestId)).status, 'rejected');
    }
    assert.equal((await db.store.pool.query('SELECT * FROM platform_events')).rowCount, 2, 'rejected gates produce no events');
    allowed = true;
    for (const scopeId of [player, npcScope]) {
      const requestId = randomUUID();
      await harness.submit({ scopeId, requestId, expectedMemoryVersion: 1, bindingId: 'test.gated', bindingVersion: '1', input: { exitId: 'west' } }); await harness.drain();
      assert.equal((await harness.get(scopeId, requestId)).status, 'committed');
    }
    await db.store.pool.query("UPDATE mud_npcs SET room_id='' WHERE npc_id='guide'");
    const offstageRequest = randomUUID();
    await harness.submit({ scopeId: npcScope, requestId: offstageRequest, expectedMemoryVersion: 2, bindingId: 'test.move', bindingVersion: '1', input: { exitId: 'east' } }); await harness.drain();
    assert.equal((await harness.get(npcScope, offstageRequest)).status, 'rejected');
    await db.store.pool.query("UPDATE game_npc_actors SET enabled=false WHERE scope_id=$1", [npcScope]);
    await assert.rejects(harness.submit({ scopeId: npcScope, requestId: randomUUID(), expectedMemoryVersion: 1, bindingId: 'test.move', bindingVersion: '1', input: { exitId: 'west' } }), /FORBIDDEN/);
    await db.store.pool.query('UPDATE mud_characters SET active=false WHERE scope_id=$1', [player]);
    await assert.rejects(harness.submit({ scopeId: player, requestId: randomUUID(), expectedMemoryVersion: 1, bindingId: 'test.move', bindingVersion: '1', input: { exitId: 'west' } }), /FORBIDDEN/);
  } finally { await harness.close(); await db.stop(); }
});
