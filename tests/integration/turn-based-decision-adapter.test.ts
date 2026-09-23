import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ScriptedModel } from '@game-ai/model';
import { RoomRuntime, migrateTurnBased, type DecisionAdapter, type RoomDefinition } from '@game-ai/turn-based';
import { startTestDatabase } from '../support/database.ts';

let db: Awaited<ReturnType<typeof startTestDatabase>>;
let runtime: RoomRuntime;
before(async () => {
  db = await startTestDatabase();
  await db.store.migrate();
  await db.store.transaction(migrateTurnBased);
});
after(async () => { await runtime?.close(); await db?.stop(); });

test('script and model adapters submit the same SELECT contract through one room judge', async () => {
  const script: DecisionAdapter = {
    async decide(input) {
      assert.equal(input.intent, 'SELECT');
      assert.equal(input.context.self.seat, 1);
      return { kind: 'proposal', value: { selected: 'A' } };
    },
  };
  const model = new ScriptedModel(() => JSON.stringify({ selected: 'A' }));
  const def: RoomDefinition = {
    id: 'adapter-neutral', version: '1', seats: 2, instructions: 'Choose A or B.',
    initialize: () => ({ state: { private: 'hidden' }, phase: {
      key: 'choose', label: 'Choose', round: 1, mode: 'sequential', actors: [1, 2],
      schema: { type: 'object', additionalProperties: false, required: ['choice'], properties: { choice: { enum: ['A', 'B'] } } },
    } }),
    project: () => ({}), validate: (_state, _phase, _seat, value) => (value as {choice: string}).choice === 'A',
    resolve: (state, _phase, decisions) => ({ state, result: decisions.map(item => item.value) }),
    decisionSpec: (room, seat) => ({
      intent: 'SELECT', scene: 'choose', actor: { roomId: room.id, seat, phaseInstance: room.phaseInstance },
      context: { rules: {}, game_state: {}, self: { seat, name: `${seat}`, role: null },
        private_information: {}, public_history: [],
        current_action: { request_type: 'SELECT', scene: 'choose', phaseInstance: room.phaseInstance, options: [] } },
      options: [{ id: 'A', value: { choice: 'A' } }, { id: 'B', value: { choice: 'B' } }],
      outputSchema: { type: 'object', additionalProperties: false, required: ['selected'], properties: { selected: { enum: ['A', 'B'] } } },
    }),
    decodeDecision: (_input, output) => output.kind === 'proposal' && 'selected' in output.value
      ? { choice: output.value.selected } : null,
  };
  runtime = new RoomRuntime(db.store, def, { script, model });
  const room = await runtime.create(randomUUID());
  await runtime.seat(room.id, { seat: 1, name: 'One', modelProfile: 'script' });
  await runtime.seat(room.id, { seat: 2, name: 'Two', modelProfile: 'model' });
  await runtime.tick(room.id);
  await runtime.tick(room.id);
  const result = await runtime.spectate(room.id);
  assert.equal(result.status, 'finished');
  assert.equal(model.calls.length, 1);
  assert.match(JSON.stringify(model.calls[0].messages), /current_action|SELECT/);
  const calls = await db.store.pool.query('SELECT count(*)::int AS n FROM fw_model_calls');
  assert.equal(calls.rows[0].n, 1);
});
