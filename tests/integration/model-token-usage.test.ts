import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestDatabase } from '../support/database.ts';
import { summarizeRoomTokenUsage } from '../../apps/server/src/model-token-usage.ts';
import { WerewolfModelService } from '../../apps/server/src/werewolf-model-service.ts';

let db: Awaited<ReturnType<typeof startTestDatabase>>;
before(async () => { db = await startTestDatabase(); await db.store.migrate(); });
after(async () => { await db?.stop(); });

async function event(roomId: string, type: string, details: object, result = 'succeeded') {
  await db.store.pool.query(`INSERT INTO fw_event_log
    (event_id,event_type,occurred_at,mod_id,room_id,request_id,result,details)
    VALUES($1,$2,now(),'werewolf',$3,$4,$5,$6)`, [randomUUID(), type, roomId,
      randomUUID(), result, JSON.stringify(details)]);
}

test('MT-01/02/03/04/05/08: per-room totals use only provider-reported successful attempts', async () => {
  const room = randomUUID();
  const other = randomUUID();
  await event(room, 'model.call.finished.v1', { simulated: false,
    usage: { inputTokens: 10, outputTokens: 3 } });
  // A correction attempt consumes tokens even if its output was invalid.
  await event(room, 'model.call.finished.v1', { simulated: false, schemaValid: false,
    usage: { inputTokens: 20, outputTokens: 4 } });
  await event(room, 'model.call.finished.v1', { simulated: false, usage: null });
  await event(room, 'model.call.finished.v1', { simulated: false,
    usage: { inputTokens: -1, outputTokens: 7 } });
  await event(room, 'model.call.finished.v1', { simulated: false,
    usage: { inputTokens: 1.5, outputTokens: 7 } });
  await event(room, 'model.call.finished.v1', { simulated: false,
    usage: { inputTokens: 8 } });
  await event(room, 'model.call.failed.v1', { simulated: false, errorCode: 'MODEL_UNAVAILABLE' }, 'failed');
  await event(room, 'model.call.started.v1', { simulated: false }, 'started');
  await event(room, 'model.call.finished.v1', { simulated: true,
    usage: { inputTokens: 999, outputTokens: 999 } });
  await event(other, 'model.call.finished.v1', { simulated: false,
    usage: { inputTokens: 100, outputTokens: 100 } });
  const expected = { roomId: room, inputTokens: 30, outputTokens: 7,
    reportedCalls: 2, unreportedCalls: 4 };
  assert.deepEqual(await summarizeRoomTokenUsage(db.store, room), expected);
  assert.deepEqual(await summarizeRoomTokenUsage(db.store, room), expected);
  assert.deepEqual(await summarizeRoomTokenUsage(db.store, other), { roomId: other,
    inputTokens: 100, outputTokens: 100, reportedCalls: 1, unreportedCalls: 0 });
});

test('MT-08: aggregate overflow is rejected instead of truncated', async () => {
  const room = randomUUID();
  await event(room, 'model.call.finished.v1', { simulated: false,
    usage: { inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 1 } });
  await event(room, 'model.call.finished.v1', { simulated: false,
    usage: { inputTokens: 1, outputTokens: 1 } });
  await assert.rejects(() => summarizeRoomTokenUsage(db.store, room), /MODEL_USAGE_OVERFLOW/);
});

test('MT-07: model service needs no prices and leaves the legacy budget table untouched', async () => {
  const names = ['MODEL_BASE_URL', 'MODEL_NAME', 'MODEL_API_KEY', 'MODEL_PROTOCOL',
    'MODEL_INPUT_CNY_PER_MILLION', 'MODEL_OUTPUT_CNY_PER_MILLION'] as const;
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, { MODEL_BASE_URL: 'https://api.deepseek.com', MODEL_NAME: 'test-model',
    MODEL_API_KEY: 'test-only', MODEL_PROTOCOL: 'deepseek' });
  delete process.env.MODEL_INPUT_CNY_PER_MILLION;
  delete process.env.MODEL_OUTPUT_CNY_PER_MILLION;
  try {
    const service = new WerewolfModelService(db.store);
    await service.migrate();
    assert.equal((await db.store.pool.query("SELECT to_regclass('ww_model_budget') AS name")).rows[0].name, null);
    await db.store.pool.query(`CREATE TABLE ww_model_budget (id text PRIMARY KEY, spent_micro_cny bigint NOT NULL)`);
    await db.store.pool.query("INSERT INTO ww_model_budget VALUES ('trial-v1', 9986936)");
    await service.migrate();
    const row = (await db.store.pool.query("SELECT spent_micro_cny FROM ww_model_budget WHERE id='trial-v1'")).rows[0];
    assert.equal(Number(row.spent_micro_cny), 9986936);
    await service.close();
  } finally {
    for (const name of names) {
      const value = previous[name];
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
