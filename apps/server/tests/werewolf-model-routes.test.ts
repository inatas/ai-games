import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWerewolfDemo } from '../src/werewolf-demo.ts';
import type { WerewolfModelService } from '../src/werewolf-model-service.ts';

test('model room has its own start/read route and becomes selectable only when service is configured', async () => {
  const service = {
    async start() { return { id: 'model-room', status: 'running' }; },
    async get() { return { id: 'model-room', status: 'running' }; },
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
  } finally { await app.close(); }
});
