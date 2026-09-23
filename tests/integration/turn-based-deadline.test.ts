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
