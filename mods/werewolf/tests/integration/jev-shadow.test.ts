import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestDatabase } from '../../../../tests/support/database.ts';
import { JevShadowWorker } from '../../server/jev-shadow.ts';

const selectRequest = {
  messages: [
    { role: 'system', content: '只有本席知识' },
    { role: 'user', content: 'CURRENT_FACTS:' + JSON.stringify({ current_action: {
      request_type: 'SELECT', options: [
        { id: 'option-0', value: { kind: 'pass' } },
        { id: 'option-1', value: { kind: 'vote', target: 5 } },
      ],
    } }) },
  ],
  outputSchema: { properties: { selected: { enum: ['option-0', 'option-1'] } } },
};

test('JS-02/03/04: shadow SELECT is logged once and never affects the source request', async () => {
  const db = await startTestDatabase();
  const calls: unknown[] = [];
  const fetchFn = async (_url: string | URL | Request, init?: RequestInit) => {
    assert.equal(init?.headers && (init.headers as Record<string, string>).Authorization, 'Bearer test-only');
    calls.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ model: 'jev-1.13.0', answers: { selected: {
      type: 'choice', choice: 'option-1', confidence: 0.81,
      probabilities: { 'option-0': 0.2, 'option-1': 0.8 },
    } }, usage: { input_tokens: 250, output_tokens: 8 } }), { status: 200 });
  };
  const worker = new JevShadowWorker(db.store, { apiKey: 'test-only', fetchFn });
  try {
    await db.store.migrate();
    await worker.activate();
    const roomId = randomUUID();
    const sourceId = randomUUID();
    const append = async (modId: string, requestId: string, attempt: number, request: object, simulated = false) => {
      await db.store.pool.query(`INSERT INTO fw_event_log
        (event_id,event_type,occurred_at,mod_id,room_id,request_id,result,details)
        VALUES($1,'model.call.started.v1',now(),$2,$3,$4,'started',$5)`, [
        randomUUID(), modId, roomId, requestId,
        JSON.stringify({ attempt, simulated, seatNo: 3, role: 'seer', scene: 'vote', scopeId: randomUUID(), modelRequest: request }),
      ]);
    };
    await append('werewolf', sourceId, 1, selectRequest);
    await append('werewolf', randomUUID(), 1, { ...selectRequest,
      outputSchema: { properties: { speech: { type: 'string' } } } });
    await append('werewolf', randomUUID(), 1, selectRequest, true);
    await append('qingxi', randomUUID(), 1, selectRequest);
    await append('werewolf', randomUUID(), 2, selectRequest);
    await worker.runOnce();
    await worker.runOnce();
    assert.equal(calls.length, 1);
    assert.deepEqual((calls[0] as any).state.messages, selectRequest.messages);
    const events = (await db.store.pool.query(`SELECT event_type,result,details FROM fw_event_log
      WHERE request_id=$1 AND event_type LIKE 'model.shadow.jev.%' ORDER BY sequence`, [sourceId])).rows;
    assert.deepEqual(events.map(event => event.event_type), [
      'model.shadow.jev.started.v1', 'model.shadow.jev.finished.v1',
    ]);
    assert.equal(events[1].details.choice, 'option-1');
    assert.equal(events[1].details.usage.inputTokens, 250);
    assert.equal(events[1].details.probabilities['option-0'], 0.2);
    assert.equal(JSON.stringify(events).includes('test-only'), false);
    assert.equal((await db.store.pool.query(`SELECT count(*)::int AS n FROM fw_requests WHERE request_id=$1`,
      [sourceId])).rows[0].n, 0);
    await new JevShadowWorker(db.store, { apiKey: 'test-only', fetchFn }).runOnce();
    assert.equal(calls.length, 1);
  } finally { await db.stop(); }
});

test('JS-03: HTTP failure is private and sanitized', async () => {
  const db = await startTestDatabase();
  const worker = new JevShadowWorker(db.store, { apiKey: 'test-only', fetchFn: async () =>
    new Response('provider secret error', { status: 503 }) });
  try {
    await db.store.migrate(); await worker.activate();
    const id = randomUUID();
    await db.store.pool.query(`INSERT INTO fw_event_log
      (event_id,event_type,occurred_at,mod_id,room_id,request_id,result,details)
      VALUES($1,'model.call.started.v1',now(),'werewolf',$2,$3,'started',$4)`, [
      randomUUID(), randomUUID(), id, JSON.stringify({ attempt: 1, simulated: false,
        scopeId: randomUUID(), modelRequest: selectRequest }),
    ]);
    await worker.runOnce();
    const events = (await db.store.pool.query(`SELECT event_type,details FROM fw_event_log
      WHERE request_id=$1 AND event_type LIKE 'model.shadow.jev.%' ORDER BY sequence`, [id])).rows;
    assert.deepEqual(events.map(event => event.event_type), [
      'model.shadow.jev.started.v1', 'model.shadow.jev.failed.v1',
    ]);
    assert.equal(events[1].details.httpStatus, 503);
    assert.equal(JSON.stringify(events).includes('provider secret error'), false);
  } finally { await db.stop(); }
});

test('JS-03/04: invalid provider output is failed; stranded paid attempt becomes unknown without retry', async () => {
  const db = await startTestDatabase();
  let calls = 0;
  const worker = new JevShadowWorker(db.store, { apiKey: 'test-only', fetchFn: async () => {
    calls++;
    return new Response('{invalid json', { status: 200 });
  } });
  try {
    await db.store.migrate(); await worker.activate();
    const id = randomUUID();
    await db.store.pool.query(`INSERT INTO fw_event_log
      (event_id,event_type,occurred_at,mod_id,room_id,request_id,result,details)
      VALUES($1,'model.call.started.v1',now(),'werewolf',$2,$3,'started',$4)`, [
      randomUUID(), randomUUID(), id, JSON.stringify({ attempt: 1, simulated: false,
        scopeId: randomUUID(), modelRequest: selectRequest }),
    ]);
    await worker.runOnce();
    const failed = (await db.store.pool.query(`SELECT details FROM fw_event_log
      WHERE request_id=$1 AND event_type='model.shadow.jev.failed.v1'`, [id])).rows[0];
    assert.equal(failed.details.errorCode, 'JEV_INVALID_RESPONSE');
    await worker.runOnce();
    assert.equal(calls, 1);

    const strandedId = randomUUID();
    await db.store.pool.query(`INSERT INTO fw_event_log
      (event_id,event_type,occurred_at,mod_id,room_id,request_id,result,details)
      VALUES($1,'model.shadow.jev.started.v1',now() - interval '1 minute','werewolf',$2,$3,'started',$4)`, [
      randomUUID(), randomUUID(), strandedId, JSON.stringify({ attempt: 1, sourceSequence: 1 }),
    ]);
    await worker.runOnce();
    await worker.runOnce();
    assert.equal(calls, 1);
    const unknown = (await db.store.pool.query(`SELECT count(*)::int AS n FROM fw_event_log
      WHERE request_id=$1 AND event_type='model.shadow.jev.unknown.v1'`, [strandedId])).rows[0];
    assert.equal(unknown.n, 1);
  } finally { await db.stop(); }
});

test('JS-03: provider timeout is recorded without leaking the exception message', async () => {
  const db = await startTestDatabase();
  const worker = new JevShadowWorker(db.store, { apiKey: 'test-only', fetchFn: async () => {
    throw new DOMException('private timeout details', 'TimeoutError');
  } });
  try {
    await db.store.migrate(); await worker.activate();
    const id = randomUUID();
    await db.store.pool.query(`INSERT INTO fw_event_log
      (event_id,event_type,occurred_at,mod_id,room_id,request_id,result,details)
      VALUES($1,'model.call.started.v1',now(),'werewolf',$2,$3,'started',$4)`, [
      randomUUID(), randomUUID(), id, JSON.stringify({ attempt: 1, simulated: false,
        scopeId: randomUUID(), modelRequest: selectRequest }),
    ]);
    await worker.runOnce();
    const failed = (await db.store.pool.query(`SELECT details FROM fw_event_log
      WHERE request_id=$1 AND event_type='model.shadow.jev.failed.v1'`, [id])).rows[0];
    assert.equal(failed.details.errorCode, 'JEV_TIMEOUT');
    assert.equal(JSON.stringify(failed).includes('private timeout details'), false);
  } finally { await db.stop(); }
});
