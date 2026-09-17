import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventRuntime, migratePlatform, type FactEvent } from '@game-ai/platform';
import { startTestDatabase } from '../support/database.ts';

test('EV-01/02/03/04/05: atomic facts, bounded recoverable delivery and authorized recipients', async () => {
  const db = await startTestDatabase();
  try {
    await db.store.migrate();
    await db.store.transaction(migratePlatform);
    const actor = randomUUID(), recipient = randomUUID(), outsider = randomUUID();
    await db.store.transaction(async tx => {
      await tx.query("INSERT INTO mud_realms VALUES('one','test','1','1','1',0),('two','test','1','1','1',0)");
      for (const id of [actor, recipient, outsider]) {
        await tx.query('INSERT INTO fw_scopes(id) VALUES($1)', [id]);
        await tx.query('INSERT INTO mud_characters(scope_id,realm_id,name) VALUES($1,$2,$3)', [id, id === outsider ? 'two' : 'one', id]);
      }
      await tx.query('CREATE TABLE effects(id uuid PRIMARY KEY, count integer NOT NULL)');
    });
    let now = 1000;
    const runtime = new EventRuntime(db.store, { now: () => now, leaseMs: 100 });
    runtime.registerType('test.fact', { type: 'object', additionalProperties: false, required: ['value'], properties: { value: { type: 'integer' } } });
    runtime.registerConsumer({ id: 'count', types: ['test.fact'], async apply(tx, delivery) {
      await tx.query('INSERT INTO effects VALUES($1,1) ON CONFLICT(id) DO UPDATE SET count=effects.count+1', [delivery.id]);
    } });
    const event = (): FactEvent => ({ eventId: randomUUID(), realmId: 'one', type: 'test.fact', actor: { kind: 'character', id: actor }, requestId: randomUUID(), causationId: null, chainDepth: 0, contentVersion: '1', payload: { value: 1 }, createdAt: now });
    const audience = [{ consumerId: 'count', recipient: { kind: 'character', id: recipient } }];
    const first = event();
    await assert.rejects(db.store.transaction(async tx => { await runtime.append(tx, first, audience); throw Error('rollback'); }), /rollback/);
    assert.equal((await db.store.pool.query('SELECT * FROM platform_events')).rowCount, 0);
    await db.store.transaction(tx => runtime.append(tx, first, audience));
    await db.store.transaction(tx => runtime.append(tx, first, audience));
    await assert.rejects(db.store.transaction(tx => runtime.append(tx, { ...first, payload: { value: 2 } }, audience)), /IDEMPOTENCY_CONFLICT/);
    await assert.rejects(db.store.transaction(tx => runtime.append(tx, event(), [{ consumerId: 'count', recipient: { kind: 'character', id: outsider } }])), /INVALID_RECIPIENT/);
    await assert.rejects(db.store.transaction(tx => runtime.append(tx, { ...event(), payload: { unknown: 1 } }, audience)), /INVALID_EVENT/);
    await assert.rejects(db.store.transaction(tx => runtime.append(tx, { ...event(), chainDepth: 5 }, audience)), /EVENT_CHAIN_LIMIT/);
    const abandoned = await runtime.claim();
    assert.equal(abandoned.length, 1);
    assert.equal((await runtime.claim()).length, 0);
    now += 101;
    await Promise.all([runtime.tick(), runtime.tick()]);
    assert.equal((await db.store.pool.query('SELECT count FROM effects')).rows[0].count, 1);
    await runtime.process(abandoned[0]);
    assert.equal((await db.store.pool.query('SELECT count FROM effects')).rows[0].count, 1, 'stale worker cannot consume');
    assert.equal((await db.store.pool.query('SELECT status FROM platform_event_deliveries')).rows[0].status, 'done');

    const privateEvent = event();
    await db.store.transaction(tx => runtime.append(tx, privateEvent, audience));
    await db.store.pool.query('UPDATE mud_characters SET active=false WHERE scope_id=$1', [recipient]);
    await runtime.tick();
    assert.equal((await db.store.pool.query('SELECT count(*)::int n FROM effects')).rows[0].n, 1);
    assert.equal((await db.store.pool.query('SELECT status FROM platform_event_deliveries WHERE event_id=$1', [privateEvent.eventId])).rows[0].status, 'failed');

    await db.store.pool.query('UPDATE mud_characters SET active=true WHERE scope_id=$1', [recipient]);
    runtime.registerConsumer({ id: 'fail', types: ['test.fact'], async apply(tx, delivery) {
      await tx.query('INSERT INTO effects VALUES($1,1)', [delivery.id]);
      throw Error('transient');
    } });
    const failing = event();
    await db.store.transaction(tx => runtime.append(tx, failing, [{ ...audience[0], consumerId: 'fail' }]));
    for (let i = 0; i < 3; i++) { await runtime.tick(); now += 10000; }
    const failed = (await db.store.pool.query('SELECT status,attempts FROM platform_event_deliveries WHERE event_id=$1', [failing.eventId])).rows[0];
    assert.deepEqual(failed, { status: 'failed', attempts: 3 });
    assert.equal((await db.store.pool.query('SELECT count(*)::int n FROM effects')).rows[0].n, 1, 'consumer writes roll back with failure');
  } finally { await db.stop(); }
});
