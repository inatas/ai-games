import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWerewolfDemo } from '../src/werewolf-demo.ts';
import type { WerewolfModelService } from '../src/werewolf-model-service.ts';

test('model room has its own start/read route and becomes selectable only when service is configured', async () => {
  const service = {
    async start() { return { id: 'model-room', status: 'running' }; },
    async get() { return { id: 'model-room', status: 'running' }; },
    async events(id: string, after: number, limit: number) {
      assert.equal(id, 'model-room'); assert.equal(after, 12); assert.equal(limit, 10);
      return [{ sequence: 13, eventType: 'model.call.started.v1' }];
    },
    async usage(id: string) {
      assert.equal(id, 'model-room');
      return { roomId: id, inputTokens: 21, outputTokens: 5, reportedCalls: 1, unreportedCalls: 0 };
    },
  } as unknown as WerewolfModelService;
  const app = await buildWerewolfDemo({ modelService: service, modelTestToken: 'test-token-12345678' });
  const headers = { 'x-model-test-token': 'test-token-12345678' };
  try {
    const catalog = await app.inject('/api/robot-users');
    assert.equal(catalog.statusCode, 200);
    assert.equal(catalog.json().filter((user: { available: boolean }) => user.available).length, 13);
    const users = catalog.json() as { userId: string }[];
    const start = await app.inject({ method: 'POST', url: '/api/werewolf/model/start', headers,
      payload: { requestId: 'model-run-1', seed: 42, userIds: users.slice(0, 12).map(user => user.userId) },
    });
    assert.equal(start.statusCode, 200);
    assert.equal(start.json().id, 'model-room');
    assert.equal((await app.inject('/api/werewolf/model/model-room')).json().status, 'running');
    const audit = await app.inject({ url: '/api/werewolf/model/model-room/model-events?after=12&limit=10', headers });
    assert.equal(audit.statusCode, 200);
    assert.equal(audit.json()[0].sequence, 13);
    const remote = await app.inject({ url: '/api/werewolf/model/model-room/model-events', remoteAddress: '203.0.113.5' });
    assert.equal(remote.statusCode, 403);
    const usage = await app.inject({ url: '/api/werewolf/model/model-room/usage', headers });
    assert.equal(usage.statusCode, 200);
    assert.deepEqual(usage.json(), { roomId: 'model-room', inputTokens: 21, outputTokens: 5,
      reportedCalls: 1, unreportedCalls: 0 });
    assert.equal((await app.inject({ url: '/api/werewolf/model/model-room/usage',
      remoteAddress: '203.0.113.5' })).statusCode, 403);
  } finally { await app.close(); }
});

test('WW-W06: test token authorizes diagnostics through a Docker bridge address', async () => {
  const service = {
    async profiles() { return [{ id: 'environment-default', label: 'DeepSeek', model: 'flash' }]; },
    async calls() { return [{ requestId: 'r', attempt: 1, status: 'failed' }]; },
    async call() { return { requestId: 'r', attempt: 1, events: [] }; },
    async get() { return { id: 'room', status: 'running' }; },
  } as unknown as WerewolfModelService;
  const app = await buildWerewolfDemo({ modelService: service, modelTestToken: 'test-token-12345678' });
  try {
    const request = (url: string, token?: string) => app.inject({ url, remoteAddress: '172.20.0.1',
      headers: token ? { 'x-model-test-token': token } : {} });
    assert.equal((await request('/api/werewolf/model/profiles')).statusCode, 403);
    assert.equal((await request('/api/werewolf/model/profiles', 'test-token-12345678')).statusCode, 200);
    assert.equal((await request('/api/werewolf/model/room/model-calls', 'test-token-12345678')).json()[0].status, 'failed');
    assert.equal((await request('/api/werewolf/model/room?seat=1')).statusCode, 403);
    assert.equal((await request('/api/werewolf/model/room?seat=1', 'test-token-12345678')).statusCode, 200);
  } finally { await app.close(); }
});

test('WW-W02: model start forwards per-seat profile selection', async () => {
  let selected: unknown;
  const service = { async start(_requestId: string, _seed: number, _ids: string[], profiles: unknown) {
    selected = profiles; return { id: 'configured-room', status: 'running' };
  } } as unknown as WerewolfModelService;
  const app = await buildWerewolfDemo({ modelService: service, modelTestToken: 'test-token-12345678' });
  try {
    const users = (await app.inject('/api/robot-users')).json() as { userId: string }[];
    const profileIds = Array(12).fill('environment-default');
    const result = await app.inject({ method: 'POST', url: '/api/werewolf/model/start',
      headers: { 'x-model-test-token': 'test-token-12345678' }, payload: {
      requestId: 'profile-room-1', seed: 1, userIds: users.slice(0, 12).map(user => user.userId), profileIds,
    } });
    assert.equal(result.statusCode, 200);
    assert.deepEqual(selected, profileIds);
  } finally { await app.close(); }
});
