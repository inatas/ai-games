import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../apps/server/src/app.ts';
import { minimalHost } from '../../mods/minimal/src/host.ts';
import { startTestDatabase } from '../support/database.ts';

test('SO-04: app startup fails before serving when another model-room host owns the database', async () => {
  const db = await startTestDatabase();
  const envNames = ['WEREWOLF_MODEL_ENABLED', 'JEV_SHADOW_ENABLED',
    'MODEL_BASE_URL', 'MODEL_NAME', 'MODEL_API_KEY', 'MODEL_PROTOCOL'] as const;
  const previous = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
  Object.assign(process.env, { WEREWOLF_MODEL_ENABLED: 'true', JEV_SHADOW_ENABLED: 'false',
    MODEL_BASE_URL: 'https://api.deepseek.com', MODEL_NAME: 'test-model',
    MODEL_API_KEY: 'test-only', MODEL_PROTOCOL: 'deepseek' });
  const model = { async generate(): Promise<never> { throw Error('unexpected model call'); } };
  let first: Awaited<ReturnType<typeof buildApp>> | undefined;
  let successor: Awaited<ReturnType<typeof buildApp>> | undefined;
  try {
    first = await buildApp(db.store, model, 'mock', minimalHost(db.store));
    assert.equal((await first.app.inject('/api/health')).statusCode, 200);
    await assert.rejects(() => buildApp(db.store, model, 'mock', minimalHost(db.store)),
      /MODEL_ROOM_OWNER_EXISTS/);
    assert.equal((await first.app.inject('/api/health')).statusCode, 200);
    await first.app.close();
    successor = await buildApp(db.store, model, 'mock', minimalHost(db.store));
    assert.equal((await successor.app.inject('/api/health')).statusCode, 200);
  } finally {
    await successor?.app.close();
    await first?.app.close();
    for (const name of envNames) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
    await db.stop();
  }
});
