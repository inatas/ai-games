import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { Identity, registerIdentityRoutes } from '@game-ai/identity';
import { HarnessError } from '@game-ai/core';
import { startTestDatabase } from '../support/database.ts';

test('U: neutral HTTP login cookies, restore across app instances, CSRF and logout', async () => {
  const db = await startTestDatabase();
  await db.store.migrate();
  const makeApp = (secure = false) => {
    const app = Fastify();
    app.setErrorHandler((err, req, reply) => reply.code(err instanceof HarnessError ? err.httpStatus : 400).send({ code: err instanceof HarnessError ? err.code : 'INVALID_INPUT' }));
    registerIdentityRoutes(app, new Identity(db.store, { initialize: async () => {} }), secure);
    return app;
  };
  const app = makeApp();
  let second: ReturnType<typeof makeApp> | undefined;
  try {
    const payload = { username: 'http_user', password: 'http-test-password' };
    for (const origin of [undefined, 'http://evil.example', 'https://localhost', 'null']) {
      const response = await app.inject({ method: 'POST', url: '/api/auth/login', headers: origin ? { origin } : {}, payload });
      assert.equal(response.statusCode, 403);
    }
    const headers = { origin: 'http://localhost' };
    const first = await app.inject({ method: 'POST', url: '/api/auth/login', headers, payload });
    assert.equal(first.statusCode, 200, first.body);
    const cookieHeader = String(first.headers['set-cookie']);
    assert.match(cookieHeader, /HttpOnly/); assert.match(cookieHeader, /SameSite=Lax/); assert.match(cookieHeader, /Max-Age=2592000/);
    assert.doesNotMatch(first.body, /token|password|salt/);
    const cookie = cookieHeader.split(';')[0];
    await app.close();
    second = makeApp();
    const restored = await second.inject({ url: '/api/auth/session', headers: { cookie } });
    assert.deepEqual(restored.json(), first.json());
    assert.equal(restored.headers['cache-control'], 'no-store');
    const resetPayload = { requestId: randomUUID(), expectedCurrentScopeId: first.json().currentScopeId };
    const reset = await second.inject({ method: 'POST', url: '/api/game/current/reset', headers: { ...headers, cookie }, payload: resetPayload });
    assert.equal(reset.statusCode, 200);
    assert.notEqual(reset.json().currentScopeId, first.json().currentScopeId);
    const logout = await second.inject({ method: 'POST', url: '/api/auth/logout', headers: { ...headers, cookie } });
    assert.equal(logout.statusCode, 200); assert.match(String(logout.headers['set-cookie']), /Max-Age=0/);
    assert.equal((await second.inject({ url: '/api/auth/session', headers: { cookie } })).statusCode, 401);
    const loginAgain = await second.inject({ method: 'POST', url: '/api/auth/login', headers, payload });
    assert.equal(loginAgain.json().currentScopeId, reset.json().currentScopeId);
    const secureApp = makeApp(true);
    try {
      const secure = await secureApp.inject({ method: 'POST', url: '/api/auth/login', headers: { host: 'localhost', origin: 'https://localhost' }, payload });
      assert.equal(secure.statusCode, 200); assert.match(String(secure.headers['set-cookie']), /; Secure/);
    } finally { await secureApp.close(); }
  } finally { await app.close(); await second?.close(); await db.stop(); }
});
