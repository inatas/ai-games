import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Identity } from '@game-ai/identity';
import { Harness } from '@game-ai/core';
import { ScriptedModel } from '@game-ai/model';
import { startTestDatabase } from '../support/database.ts';
import { barrier, counterBinding, request } from '../support/counter.ts';

test('U: persistent identity, authorization, atomic reset, expiry and revocation', async () => {
  const db = await startTestDatabase();
  try {
    await db.store.migrate();
    await db.store.pool.query('CREATE TABLE neutral_profiles(scope_id uuid PRIMARY KEY REFERENCES fw_scopes(id), counter integer NOT NULL)');
    let now = Date.now(); let fail = false;
    const identity = new Identity(db.store, { now: () => now, initialize: async (tx, id) => {
      await tx.query('INSERT INTO neutral_profiles VALUES($1,0)', [id]);
      if (fail) throw new Error('INITIALIZATION_FAILED');
    } });
    const first = await identity.login(' Alice ', 'test-password-1', 'local');
    await db.store.pool.query('UPDATE neutral_profiles SET counter=1 WHERE scope_id=$1', [first.currentScopeId]);
    const again = await identity.login('ALICE', 'test-password-1', 'local');
    assert.equal(again.currentScopeId, first.currentScopeId);
    assert.equal((await identity.session(first.token)).username, 'alice');
    await assert.rejects(identity.login('alice', 'incorrect-password', 'local'), /INVALID_CREDENTIALS/);
    const bob = await identity.login('bob', 'test-password-2', 'local');
    await assert.rejects(db.store.transaction(tx => identity.authorizeCurrent(tx, bob.token, first.currentScopeId)), /FORBIDDEN/);
    const requestId = randomUUID();
    const beforeFailure = Number((await db.store.pool.query('SELECT count(*) FROM fw_scopes')).rows[0].count);
    fail = true;
    await assert.rejects(identity.reset(first.token, requestId, first.currentScopeId), /INITIALIZATION_FAILED/);
    assert.equal(Number((await db.store.pool.query('SELECT count(*) FROM fw_scopes')).rows[0].count), beforeFailure);
    assert.equal((await identity.session(first.token)).currentScopeId, first.currentScopeId);
    fail = false;
    const reset = await identity.reset(first.token, requestId, first.currentScopeId);
    assert.deepEqual(await identity.reset(first.token, requestId, first.currentScopeId), reset);
    await assert.rejects(identity.reset(first.token, requestId, reset.currentScopeId), /IDEMPOTENCY_CONFLICT/);
    await assert.rejects(identity.reset(first.token, randomUUID(), first.currentScopeId), /STATE_CONFLICT/);
    assert.equal((await db.store.pool.query('SELECT counter FROM neutral_profiles WHERE scope_id=$1', [first.currentScopeId])).rows[0].counter, 1);
    await assert.rejects(db.store.transaction(tx => identity.authorizeCurrent(tx, first.token, first.currentScopeId)), /FORBIDDEN/);
    await identity.logout(first.token);
    await identity.logout(first.token);
    await assert.rejects(identity.session(first.token), /UNAUTHENTICATED/);
    assert.equal((await identity.session(again.token)).currentScopeId, reset.currentScopeId);
    now += 29 * 86400000;
    await identity.session(again.token);
    now += 29 * 86400000;
    await identity.session(again.token);
    now += 31 * 86400000;
    await assert.rejects(identity.session(again.token), /UNAUTHENTICATED/);
    assert.equal((await identity.login('alice', 'test-password-1', 'local')).currentScopeId, reset.currentScopeId);
  } finally { await db.stop(); }
});

test('U-14: action admission waits for a concurrent reset and rejects the retired scope', async () => {
  const db = await startTestDatabase();
  const gate = barrier();
  let harness: Harness | undefined;
  let resetting: Promise<unknown> | undefined;
  let actionResult: Promise<unknown> | undefined;
  try {
    await db.store.migrate();
    await db.store.pool.query('CREATE TABLE test_counters(scope_id uuid PRIMARY KEY,counter integer DEFAULT 0,version integer DEFAULT 0,allowed boolean DEFAULT true)');
    let block = false;
    const identity = new Identity(db.store, { initialize: async (tx, id) => {
      await tx.query('INSERT INTO test_counters(scope_id) VALUES($1)', [id]);
      if (block) await gate.wait();
    } });
    const user = await identity.login('race_user', 'race-password', 'local');
    const model = new ScriptedModel(() => '{"decision":"ACCEPT"}');
    harness = new Harness(db.store, model).register(counterBinding(db.store));
    block = true;
    resetting = identity.reset(user.token, randomUUID(), user.currentScopeId);
    await gate.ready;
    actionResult = assert.rejects(harness.submit(request(user.currentScopeId), tx => identity.authorizeCurrent(tx, user.token, user.currentScopeId)), /FORBIDDEN/);
    gate.release();
    await resetting; await actionResult;
    assert.equal(model.calls.length, 0);
    assert.equal(Number((await db.store.pool.query('SELECT count(*) FROM fw_requests')).rows[0].count), 0);
  } finally { gate.release(); await resetting; await actionResult; await harness?.close(); await db.stop(); }
});

test('U: concurrent registration, reset contention and failed login throttling', async () => {
  const db = await startTestDatabase();
  try {
    await db.store.migrate();
    let now = Date.now();
    const identity = new Identity(db.store, { initialize: async () => {}, now: () => now });
    for (const [name, password] of [['x', 'long-password'], ['valid', 'short'], ['valid', 'x'.repeat(129)]]) {
      await assert.rejects(identity.login(name, password, 'local'), /INVALID_INPUT/);
    }
    const logins = await Promise.all([identity.login('same', 'same-password', 'local'), identity.login('SAME', 'same-password', 'local')]);
    assert.equal(logins[0].currentScopeId, logins[1].currentScopeId);
    const resets = await Promise.allSettled(logins.map(l => identity.reset(l.token, randomUUID(), l.currentScopeId)));
    assert.equal(resets.filter(r => r.status === 'fulfilled').length, 1);
    for (let i = 0; i < 10; i++) await assert.rejects(identity.login('same', 'wrong-password', 'local'), /INVALID_CREDENTIALS/);
    await assert.rejects(identity.login('same', 'same-password', 'local'), /RATE_LIMITED/);
    now += 900000;
    await identity.login('same', 'same-password', 'local');
    const different = await Promise.allSettled(['first-password', 'other-password'].map(p => identity.login('contended', p, 'local')));
    assert.equal(different.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(different.filter(r => r.status === 'rejected').length, 1);
    assert.equal(Number((await db.store.pool.query('SELECT count(*) FROM fw_users WHERE username=$1', ['contended'])).rows[0].count), 1);
  } finally { await db.stop(); }
});
