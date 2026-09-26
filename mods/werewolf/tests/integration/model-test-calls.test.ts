import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestDatabase } from '../../../../tests/support/database.ts';
import { WerewolfModelService } from '../../server/werewolf-model-service.ts';
import { werewolfDefinition } from '../../src/definition.ts';

let db: Awaited<ReturnType<typeof startTestDatabase>>;
let service: WerewolfModelService;
const envNames = ['MODEL_BASE_URL', 'MODEL_NAME', 'MODEL_API_KEY', 'MODEL_PROTOCOL'] as const;
const previous = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
before(async () => {
  db = await startTestDatabase();
  Object.assign(process.env, { MODEL_BASE_URL: 'https://api.deepseek.com', MODEL_NAME: 'test-model',
    MODEL_API_KEY: 'test-only', MODEL_PROTOCOL: 'deepseek' });
  service = new WerewolfModelService(db.store);
  await service.migrate();
});
after(async () => {
  await service?.close();
  for (const name of envNames) {
    if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name];
  }
  await db?.stop();
});

test('ML-01/02/03/06: successful and failed attempts remain separate and privately inspectable', async () => {
  const roomId = randomUUID();
  const otherRoom = randomUUID();
  for (const id of [roomId, otherRoom]) await db.store.pool.query(`INSERT INTO tb_rooms(id,run_key,document) VALUES($1,$2,$3)`,
    [id, `werewolf-model:${id}`, JSON.stringify({ definitionId: 'werewolf', runKey: `werewolf-model:${id}`,
      definitionVersion: werewolfDefinition({ seed: 42, sheriff: 'double' }).version })]);
  const successId = randomUUID();
  const failedId = randomUUID();
  const append = async (id: string, requestId: string, eventType: string, details: object, result: string) => {
    await db.store.pool.query(`INSERT INTO fw_event_log
      (event_id,event_type,occurred_at,mod_id,room_id,request_id,result,details)
      VALUES($1,$2,now(),'werewolf',$3,$4,$5,$6)`, [randomUUID(), eventType, id, requestId, result,
      JSON.stringify({ attempt: 1, simulated: false, ...details })]);
  };
  await append(roomId, successId, 'model.call.started.v1', { seatNo: 2, scene: 'speech', modelProfile: 'environment-default',
    modelRequest: { messages: [{ role: 'system', content: 'rules' }] } }, 'started');
  await append(roomId, successId, 'model.call.finished.v1', { seatNo: 2, scene: 'speech', latencyMs: 100, schemaValid: true,
    usage: { inputTokens: 20, outputTokens: 3, promptCacheHitTokens: 12, promptCacheMissTokens: 8 },
    rawText: '{"speech":"hello"}' }, 'succeeded');
  await append(roomId, successId, 'model.call.judged.v1', { gameCommitted: false, errorCode: 'PHASE_CONFLICT' }, 'failed');
  await append(roomId, failedId, 'model.call.started.v1', { seatNo: 5, scene: 'witch', modelProfile: 'environment-default' }, 'started');
  await append(roomId, failedId, 'model.call.failed.v1', { errorCode: 'MODEL_UNAVAILABLE', httpStatus: 503,
    transportCategory: 'http', latencyMs: 30 }, 'failed');
  await append(otherRoom, randomUUID(), 'model.call.started.v1', { seatNo: 1 }, 'started');
  {
    const calls = await service.calls(roomId);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].status, 'succeeded');
    assert.equal(calls[0].gameCommitted, false);
    assert.equal(calls[0].cacheHitTokens, 12);
    assert.equal(calls[1].status, 'failed');
    assert.equal(calls[1].httpStatus, 503);
    assert.equal(calls[1].inputTokens, null);
    const usage = await service.usage(roomId);
    assert.equal(usage.cacheRate, 0.6);
    assert.deepEqual(usage.cacheBySeat, [{ key: '2', hitTokens: 12, missTokens: 8, rate: 0.6, calls: 1 }]);
    assert.deepEqual(usage.cacheByPhase, [{ key: 'speech', hitTokens: 12, missTokens: 8, rate: 0.6, calls: 1 }]);
    assert.equal((await service.calls(roomId, 0, 50, 5, 'failed')).length, 1);
    const detail = await service.call(roomId, successId, 1);
    assert.equal(detail.events.length, 3);
    assert.equal(detail.events[0].details.modelRequest.messages[0].content, 'rules');
    await assert.rejects(() => service.call(otherRoom, successId, 1), /NOT_FOUND/);
  }
});
