import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { RoomRuntime, type DecisionAdapter, type RoomDefinition } from '@game-ai/turn-based';
import { startTestDatabase } from '../support/database.ts';

let db: Awaited<ReturnType<typeof startTestDatabase>>;
let runtime: RoomRuntime;
before(async () => { db = await startTestDatabase(); await db.store.migrate(); });
after(async () => { await runtime?.close(); await db?.stop(); });

test('sealed actions close at 60, settle at 90, and do not reapply after recovery tick', async () => {
  let now = 1_000;
  const ready: DecisionAdapter = { async decide(input) { return { kind: 'proposal', value: { selected: input.options[0].id } }; } };
  const absent: DecisionAdapter = { async decide() { return { kind: 'no-valid-input', reason: 'NO_REPLY' }; } };
  const definition: RoomDefinition = {
    id: 'timed-neutral', version: '1', seats: 2, instructions: 'Choose A.',
    initialize: () => ({ state: {}, phase: { key: 'window', label: 'Window', round: 1, mode: 'sealed', actors: [1, 2],
      schema: { type: 'object', additionalProperties: false, required: ['choice'], properties: { choice: { const: 'A' } } } } }),
    project: () => ({}), validate: () => true,
    resolve: (state, _phase, decisions) => ({ state, result: decisions.map(item => item.seat),
      events: [{ type: 'settled', audience: 'public', data: decisions.map(item => item.value) }] }),
    decisionSpec: (room, seat) => ({ intent: 'SELECT', scene: 'window', actor: { roomId: room.id, seat, phaseInstance: room.phaseInstance },
      context: { rules: {}, game_state: {}, self: { seat, name: `${seat}`, role: null }, private_information: {}, public_history: [],
        current_action: { request_type: 'SELECT', scene: 'window', options: [], phaseInstance: room.phaseInstance } },
      options: [{ id: 'A', value: { choice: 'A' } }],
      outputSchema: { type: 'object', required: ['selected'], properties: { selected: { const: 'A' } }, additionalProperties: false } }),
    decodeDecision: (_input, output) => output.kind === 'proposal' && 'selected' in output.value ? { choice: output.value.selected } : null,
    windowMs: () => 90, actionWindowMs: () => 60, fixedWindow: () => true,
    fallbackDecision: () => ({ choice: 'A' }),
  };
  runtime = new RoomRuntime(db.store, definition, { ready, absent }, { harness: { clock: { now: () => now } } });
  await runtime.migrate();
  const created = await runtime.create(randomUUID());
  await runtime.seat(created.id, { seat: 1, name: 'One', modelProfile: 'ready' });
  await runtime.seat(created.id, { seat: 2, name: 'Two', modelProfile: 'absent' });
  await Promise.all([runtime.tickSealed(created.id, 1), runtime.tickSealed(created.id, 2)]);
  assert.equal((await runtime.inspect(created.id)).phaseDeadlineAt, 1090);
  assert.equal((await runtime.inspect(created.id)).decisions.length, 1);
  now = 1060;
  await runtime.tick(created.id);
  assert.equal((await runtime.inspect(created.id)).decisions.length, 2);
  assert.equal((await runtime.inspect(created.id)).status, 'running');
  assert.equal((await runtime.spectate(created.id)).events.filter(event => event.type === 'settled').length, 0);
  now = 1090;
  await runtime.tick(created.id);
  assert.equal((await runtime.inspect(created.id)).status, 'finished');
  await runtime.tick(created.id);
  assert.equal((await runtime.spectate(created.id)).events.filter(event => event.type === 'settled').length, 1);
});

test('committed single-speaker decision advances three seconds later, exactly once', async () => {
  let now = 10_000;
  const speaker: DecisionAdapter = { async decide() { return { kind: 'proposal', value: { speech: 'hello' } }; } };
  const definition: RoomDefinition = {
    id: 'early-neutral', version: '1', seats: 1, instructions: 'Speak.',
    initialize: () => ({ state: {}, phase: { key: 'speech', label: 'Speak', round: 1, mode: 'sequential', actors: [1],
      schema: { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string' } } } } }),
    project: () => ({}), validate: () => true,
    resolve: state => ({ state, result: 'done', events: [{ type: 'done', audience: 'public', data: {} }] }),
    decisionSpec: (room, seat) => ({ intent: 'SPEECH', scene: 'speech', actor: { roomId: room.id, seat, phaseInstance: room.phaseInstance },
      context: { rules: {}, game_state: {}, self: { seat, name: 'One', role: null }, private_information: {}, public_history: [],
        current_action: { request_type: 'SPEECH', scene: 'speech', options: [], phaseInstance: room.phaseInstance } },
      options: [], outputSchema: { type: 'object', required: ['speech'], properties: { speech: { type: 'string' } } } }),
    decodeDecision: (_input, output) => output.kind === 'proposal' && 'speech' in output.value ? { text: output.value.speech } : null,
    windowMs: () => 120_000, fixedWindow: () => true, completionDelayMs: () => 3_000,
    fallbackDecision: () => ({ text: '' }),
  };
  runtime = new RoomRuntime(db.store, definition, { speaker }, { harness: { clock: { now: () => now } } });
  await runtime.migrate();
  const created = await runtime.create(randomUUID());
  await runtime.seat(created.id, { seat: 1, name: 'One', modelProfile: 'speaker' });
  await runtime.tick(created.id);
  assert.equal((await runtime.inspect(created.id)).phaseEarlyFinishAt, 13_000);
  const recovered = new RoomRuntime(db.store, definition, { speaker }, { harness: { clock: { now: () => now } } });
  now = 12_999;
  await recovered.tick(created.id);
  assert.equal((await runtime.inspect(created.id)).status, 'running');
  now = 13_000;
  await Promise.all([runtime.tick(created.id), recovered.tick(created.id)]);
  assert.equal((await runtime.inspect(created.id)).status, 'finished');
  assert.equal((await runtime.inspect(created.id)).phaseEarlyFinishAt, undefined);
  assert.equal((await runtime.spectate(created.id)).events.filter(event => event.type === 'done').length, 1);
  await recovered.close();

  const late = await runtime.create(randomUUID());
  await runtime.seat(late.id, { seat: 1, name: 'One', modelProfile: 'speaker' });
  now = 132_999;
  await runtime.tick(late.id);
  assert.equal((await runtime.inspect(late.id)).phaseEarlyFinishAt, 133_000);
  now = 133_000;
  await runtime.tick(late.id);
  assert.equal((await runtime.inspect(late.id)).status, 'finished');

  const silent: DecisionAdapter = { async decide() { return { kind: 'no-valid-input', reason: 'NO_SPEECH' }; } };
  const silentRuntime = new RoomRuntime(db.store, definition, { speaker: silent }, { harness: { clock: { now: () => now } } });
  const silentRoom = await silentRuntime.create(randomUUID());
  await silentRuntime.seat(silentRoom.id, { seat: 1, name: 'One', modelProfile: 'speaker' });
  await silentRuntime.tick(silentRoom.id);
  assert.equal((await silentRuntime.inspect(silentRoom.id)).phaseEarlyFinishAt, undefined);
  now = 252_999;
  await silentRuntime.tick(silentRoom.id);
  assert.equal((await silentRuntime.inspect(silentRoom.id)).status, 'running');
  now = 253_000;
  await silentRuntime.tick(silentRoom.id);
  assert.equal((await silentRuntime.inspect(silentRoom.id)).status, 'finished');
  await silentRuntime.close();
});
