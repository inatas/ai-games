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
  } as unknown as WerewolfModelService;
  const app = await buildWerewolfDemo({ modelService: service });
  try {
    const catalog = await app.inject('/api/robot-users');
    assert.equal(catalog.statusCode, 200);
    assert.equal(catalog.json().filter((user: { available: boolean }) => user.available).length, 13);
    const users = catalog.json() as { userId: string }[];
    const start = await app.inject({ method: 'POST', url: '/api/werewolf/model/start',
      payload: { requestId: 'model-run-1', seed: 42, userIds: users.slice(0, 12).map(user => user.userId) },
    });
    assert.equal(start.statusCode, 200);
    assert.equal(start.json().id, 'model-room');
    assert.equal((await app.inject('/api/werewolf/model/model-room')).json().status, 'running');
    const audit = await app.inject('/api/werewolf/model/model-room/model-events?after=12&limit=10');
    assert.equal(audit.statusCode, 200);
    assert.equal(audit.json()[0].sequence, 13);
    const remote = await app.inject({ url: '/api/werewolf/model/model-room/model-events', remoteAddress: '203.0.113.5' });
    assert.equal(remote.statusCode, 403);
  } finally { await app.close(); }
});
