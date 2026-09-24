import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Harness } from '@game-ai/core';
import { Identity } from '@game-ai/identity';
import { loadWorldview } from '@game-ai/storage';
import { ScriptedModel } from '@game-ai/model';
import { startTestDatabase } from '../support/database.ts';
import { counterBinding, request, barrier } from '../support/counter.ts';

test('W: configuration rejects invalid files and immutable versions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'harness-world-'));
  const db = await startTestDatabase();
  try {
    await db.store.migrate();
    const file = join(dir, 'WORLD.md');
    await assert.rejects(loadWorldview(file, 'a', '1'));
    for (const content of ['', ' '.repeat(2), 'a'.repeat(16385), Buffer.from([0xff, 0xfe, 0xfa])]) {
      await writeFile(file, content);
      await assert.rejects(loadWorldview(file, 'a', '1'));
    }
    await writeFile(file, 'Peaceful world');
    const world = await loadWorldview(file, 'a', '1');
    await db.store.registerWorldview(world);
    await db.store.registerWorldview(world);
    await writeFile(file, 'Winter world');
    await assert.rejects(db.store.registerWorldview(await loadWorldview(file, 'a', '1')), /WORLDVIEW_VERSION_CONFLICT/);
    await db.store.registerWorldview(await loadWorldview(file, 'a', '2'));
  } finally { await db.stop(); await unlink(join(dir, 'WORLD.md')).catch(() => {}); await rmdir(dir); }
});

test('W/U: scope versions, mandatory budget, repair provenance and action/reset serialization', async () => {
  const db = await startTestDatabase();
  let h: Harness | undefined;
  const gate = barrier();
  try {
    await db.store.migrate();
    await db.store.pool.query('CREATE TABLE test_counters(scope_id uuid PRIMARY KEY,counter integer DEFAULT 0,version integer DEFAULT 0,allowed boolean DEFAULT true)');
    const world1 = { worldId: 'neutral', version: '1', content: 'Peaceful world', digest: 'peace-digest' };
    const world2 = { worldId: 'neutral', version: '2', content: 'Winter world', digest: 'winter-digest' };
    await db.store.registerWorldview(world1); await db.store.registerWorldview(world2);
    const initialize = async (tx: any, id: string) => { await tx.query('INSERT INTO test_counters(scope_id) VALUES($1)', [id]); };
    const oldService = new Identity(db.store, { worldview: world1, initialize });
    const user = await oldService.login('world_user', 'world-password', 'local');
    const newService = new Identity(db.store, { worldview: world2, initialize });
    assert.equal((await newService.login('world_user', 'world-password', 'local')).currentScopeId, user.currentScopeId);
    assert.deepEqual(await db.store.worldview(user.currentScopeId), world1);
    let calls = 0;
    const model = new ScriptedModel(async () => { if (++calls === 1) { await gate.wait(); return '{broken'; } return '{"decision":"ACCEPT"}'; });
    h = new Harness(db.store, model).register(counterBinding(db.store));
    const input = request(user.currentScopeId);
    await h.submit(input, tx => newService.authorizeCurrent(tx, user.token, user.currentScopeId));
    await gate.ready;
    await assert.rejects(newService.reset(user.token, request(user.currentScopeId).requestId, user.currentScopeId), /SCOPE_BUSY/);
    gate.release(); await h.drain();
    assert.equal(model.calls.length, 2);
    for (const call of model.calls) assert.equal(JSON.parse(call.messages[2].content.slice('WORLDVIEW:'.length)).content, world1.content);
    const records = (await db.store.pool.query("SELECT details FROM fw_event_log WHERE request_id=$1 AND event_type='model.call.started.v1'", [input.requestId])).rows;
    assert.equal(records.length, 2); assert.ok(records.every(r => r.details.worldVersion === '1' && r.details.worldDigest === world1.digest));
    const next = await newService.reset(user.token, request(user.currentScopeId).requestId, user.currentScopeId);
    assert.deepEqual(await db.store.worldview(next.currentScopeId), world2);
    await assert.rejects(h.submit(request(user.currentScopeId, 1), tx => newService.authorizeCurrent(tx, user.token, user.currentScopeId)), /FORBIDDEN/);
    const noBudgetModel = new ScriptedModel(() => '{"decision":"ACCEPT"}');
    const limited = new Harness(db.store, noBudgetModel, { inputBudget: 100 }).register(counterBinding(db.store));
    const tooLarge = request(next.currentScopeId);
    await limited.submit(tooLarge); await limited.drain();
    assert.equal((await limited.get(next.currentScopeId, tooLarge.requestId)).error?.code, 'CONTEXT_TOO_LARGE');
    assert.equal(noBudgetModel.calls.length, 0);
    const direct = new Harness(db.store, noBudgetModel).register(counterBinding(db.store, { mode: 'recordMemory' }));
    await direct.submit(request(next.currentScopeId)); await direct.drain();
    assert.equal(noBudgetModel.calls.length, 0);
    assert.deepEqual(await db.store.worldview(next.currentScopeId), world2);
    const unavailable = new Harness(db.store, new ScriptedModel(() => { throw Error('offline'); })).register(counterBinding(db.store));
    const failed = request(next.currentScopeId, 1);
    await unavailable.submit(failed); await unavailable.drain();
    const started = (await db.store.pool.query("SELECT details FROM fw_event_log WHERE request_id=$1 AND event_type='model.call.started.v1'", [failed.requestId])).rows[0];
    const failedCall = (await db.store.pool.query("SELECT details FROM fw_event_log WHERE request_id=$1 AND event_type='model.call.failed.v1'", [failed.requestId])).rows[0];
    assert.equal(started.details.worldVersion, '2');
    assert.equal(started.details.worldDigest, world2.digest);
    assert.equal(failedCall.details.errorCode, 'MODEL_UNAVAILABLE');
  } finally { gate.release(); await h?.close(); await db.stop(); }
});
