import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWerewolfDemo } from '../../../apps/server/src/werewolf-demo.ts';

test('UI-03/04: HTTP sessions reject unknown access and make concurrent revision retries idempotent', async t => {
  const app = await buildWerewolfDemo();
  t.after(() => app.close());
  const created = await app.inject({ method: 'POST', url: '/api/werewolf/demo', payload: { seed: 42, strategy: 'random' } });
  assert.equal(created.statusCode, 200);
  const first = created.json();
  assert.equal(first.actor, null);
  assert.equal(first.roles, undefined);
  const [a, b] = await Promise.all([1, 2].map(() => app.inject({ method: 'POST', url: `/api/werewolf/demo/${first.id}/step`, payload: { revision: first.revision } })));
  assert.equal(a.statusCode, 200);
  assert.deepEqual(a.json(), b.json());
  assert.equal(a.json().revision, first.revision + 1);
  assert.equal((await app.inject({ method: 'GET', url: '/api/werewolf/demo/unknown' })).statusCode, 404);
  assert.equal((await app.inject({ method: 'POST', url: `/api/werewolf/demo/${first.id}/step`, payload: { revision: 999 } })).statusCode, 409);
  assert.equal((await app.inject({ method: 'POST', url: '/api/werewolf/demo', headers: { origin: 'https://other.example' }, payload: { seed: 42, strategy: 'random' } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: '/api/werewolf/demo', payload: { seed: -1, strategy: 'random' } })).statusCode, 400);
});

test('UI-04: malformed control payload is rejected without advancing the room', async t => {
  const app = await buildWerewolfDemo();
  t.after(() => app.close());
  const first = (await app.inject({ method: 'POST', url: '/api/werewolf/demo', payload: { seed: 42, strategy: 'fixed' } })).json();
  const rejected = await app.inject({ method: 'POST', url: `/api/werewolf/demo/${first.id}/step`, payload: { revision: first.revision, target: 1 } });
  assert.equal(rejected.statusCode, 400);
  assert.deepEqual((await app.inject({ method: 'GET', url: `/api/werewolf/demo/${first.id}` })).json(), first);
});

test('UI-06: demo plugin stays isolated from the original application routes', async t => {
  const { default: Fastify } = await import('fastify');
  const { werewolfDemoRoutes } = await import('../../../apps/server/src/werewolf-demo.ts');
  const app = Fastify();
  t.after(() => app.close());
  app.get('/api/existing', () => ({ retained: true }));
  await app.register(werewolfDemoRoutes);
  assert.deepEqual((await app.inject({ url: '/api/existing', headers: { origin: 'https://unrelated.example' } })).json(), { retained: true });
  assert.equal((await app.inject({ method: 'POST', url: '/api/werewolf/demo', payload: { seed: 42, strategy: 'fixed' } })).statusCode, 200);
});
