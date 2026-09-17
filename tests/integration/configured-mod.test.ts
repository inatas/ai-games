import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../../apps/server/src/app.ts';
import { minimalHost } from '../../mods/minimal/src/host.ts';
import { startTestDatabase } from '../support/database.ts';

test('MP-04/05: copied JSON MOD runs via common HTTP and preserves state across restart', async () => {
  const db = await startTestDatabase();
  const model = { async generate(): Promise<never> { throw Error('unexpected model'); } };
  let built = await buildApp(db.store, model, 'mock', minimalHost(db.store));
  try {
    const login = await built.app.inject({ method: 'POST', url: '/api/auth/login', headers: { origin: 'http://localhost' }, payload: { username: 'minimal_user', password: 'test-password' } });
    assert.equal(login.statusCode, 200, login.body);
    const headers = { cookie: String(login.headers['set-cookie']).split(';')[0], origin: 'http://localhost' };
    const before = (await built.app.inject({ url: '/api/mud/current', headers })).json();
    const requestId = randomUUID();
    const moved = await built.app.inject({ method: 'POST', url: '/api/mud/actions', headers, payload: { requestId, expectedMemoryVersion: 0, action: 'move', exitId: 'east', note: '' } });
    assert.equal(moved.statusCode, 202, moved.body); await built.harness.drain();
    assert.equal((await built.app.inject({ url: '/api/mud/current', headers })).json().scene.roomId, 'b');
    const forged = await built.app.inject({ method: 'POST', url: '/api/mud/actions', headers, payload: { requestId: randomUUID(), expectedMemoryVersion: 1, action: 'move', exitId: 'west', note: '', actor: { kind: 'npc', npcId: 'guide' } } });
    assert.equal(forged.statusCode, 400);
    await built.app.close();
    const host = minimalHost(db.store);
    built = await buildApp(db.store, model, 'mock', host);
    await db.store.transaction(tx => host.initialize(tx, before.scopeId));
    assert.equal((await built.app.inject({ url: '/api/mud/current', headers })).json().scene.roomId, 'b');
    assert.equal((await db.store.pool.query('SELECT * FROM platform_events')).rowCount, 1);
    assert.equal((await db.store.pool.query('SELECT * FROM game_npc_actors')).rowCount, 1);
  } finally { await built.app.close(); await db.stop(); }
});
