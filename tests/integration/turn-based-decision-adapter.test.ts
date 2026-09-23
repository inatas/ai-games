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
      assert.doesNotMatch(JSON.stringify(input.context.rules), /Private model guidance/);
      return { kind: 'proposal', value: { selected: 'A' } };
    },
  };
  const model = new ScriptedModel(() => JSON.stringify({ selected: 'A' }));
  const modelUserId = randomUUID();
  const def: RoomDefinition = {
    id: 'adapter-neutral', version: '1', seats: 2, instructions: 'Choose A or B.',
    decisionRules: { id: 'neutral-guidance', version: 1, rules: [{
      id: 'second-seat-guidance', priority: 10, mode: 'guidance', instruction: 'Private model guidance',
      matches: input => input.actor.seat === 2,
    }] },
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
  await runtime.seat(room.id, { seat: 1, name: 'One', modelProfile: 'script', controllerKind: 'robot' });
  await runtime.seat(room.id, { seat: 2, name: 'Two', modelProfile: 'model', userId: modelUserId, controllerKind: 'robot' });
  await runtime.tick(room.id);
  await runtime.tick(room.id);
  const result = await runtime.spectate(room.id);
  assert.equal(result.status, 'finished');
  assert.equal(model.calls.length, 1);
  assert.match(JSON.stringify(model.calls[0].messages), /current_action|SELECT/);
  assert.match(JSON.stringify(model.calls[0].messages), /Private model guidance/);
  assert.doesNotMatch(JSON.stringify(result), /Private model guidance/);
  const calls = await db.store.pool.query("SELECT count(*)::int AS n FROM fw_event_log WHERE event_type='model.call.finished.v1'");
  assert.equal(calls.rows[0].n, 1);
  const audit = (await db.store.pool.query("SELECT user_id,mod_id,room_id,details FROM fw_event_log WHERE room_id=$1 AND event_type='model.call.started.v1'", [room.id])).rows[0];
  assert.equal(audit.user_id, modelUserId);
  assert.equal(audit.mod_id, def.id);
  assert.equal(audit.room_id, room.id);
  assert.equal(audit.details.modelProfile, 'model');
  assert.equal(audit.details.phaseInstance, 1);
});
