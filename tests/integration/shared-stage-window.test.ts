import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { HarnessError } from '@game-ai/core';
import { ScriptedModel } from '@game-ai/model';
import { RoomRuntime, type RoomDefinition, type Phase } from '@game-ai/turn-based';
import { startTestDatabase } from '../support/database.ts';

type State = { step: number; origins: string[] };
function staged(extra: Partial<RoomDefinition> = {}): RoomDefinition {
  const phase = (step: number): Phase => ({ key: `step-${step}`, label: 'Preparation', round: 1,
    mode: 'sequential', actors: [1], schema: { type: 'object', additionalProperties: false,
      required: ['kind'], properties: { kind: { const: 'go' } } },
    ...({ windowGroup: step < 3 ? 'preparation:1' : undefined } as object),
  });
  return { id: 'staged-test', version: '1', seats: 2, instructions: 'Return go.',
    initialize: () => ({ state: { step: 0, origins: [] }, phase: phase(0) }),
    project: () => ({ visible: true }), validate: () => true,
    resolve: (raw, _phase, decisions) => {
      const old = raw as unknown as State;
      const state = { step: old.step + 1, origins: [...old.origins, (decisions[0] as { origin?: string }).origin ?? 'missing'] };
      return state.step > 3 ? { state, result: 'finished' } : { state, phase: phase(state.step) };
    }, windowMs: room => room.phase?.key === 'step-3' ? 20_000 : 45_000,
    fixedWindow: room => room.phase?.key === 'step-2', fallbackDecision: () => ({ kind: 'go' }), ...extra,
  };
}
async function ready(runtime: RoomRuntime) {
  await runtime.migrate();
  const room = await runtime.create(randomUUID());
  for (let seat = 1; seat <= 2; seat++) await runtime.seat(room.id, { seat, name: `${seat}`, modelProfile: 'model' });
  return runtime.inspect(room.id);
}

test('TB-WG01/02/04/07: successful steps share durable cutoff; fixed wait and restart do not extend it', async () => {
  const db = await startTestDatabase();
  let now = 1_000;
  const definition = staged();
  const model = new ScriptedModel(() => '{"kind":"go"}');
  let runtime = new RoomRuntime(db.store, definition, { model }, { harness: { clock: { now: () => now } } });
  try {
    await db.store.migrate(); const created = await ready(runtime);
    const deadline = created.phaseDeadlineAt!;
    now += 7_000; await runtime.tick(created.id);
    assert.equal((await runtime.inspect(created.id)).phaseDeadlineAt, deadline);
    await runtime.close();
    runtime = new RoomRuntime(db.store, definition, { model }, { harness: { clock: { now: () => now } } });
    now += 4_000; await runtime.tick(created.id);
    assert.equal((await runtime.inspect(created.id)).phaseDeadlineAt, deadline);
    await runtime.tick(created.id);
    assert.equal((await runtime.inspect(created.id)).phase?.key, 'step-2');
    now = deadline; await runtime.tick(created.id);
    const next = await runtime.inspect(created.id);
    assert.equal(next.phase?.key, 'step-3');
    assert.equal(next.phaseDeadlineAt, deadline + 20_000);
    assert.deepEqual((next.state as unknown as State).origins, ['model', 'model', 'model']);
  } finally { await runtime.close(); await db.stop(); }
});

test('TB-WG03/05/06: terminal failure immediately continues; insufficient remaining time makes no new call', async () => {
  const db = await startTestDatabase();
  let now = 1_000;
  const model = new ScriptedModel(() => { throw new HarnessError('MODEL_UNAVAILABLE'); });
  const definition = staged({ ...({ fallbackOnFailure: () => true, minDecisionTimeMs: () => 15_000 } as object) });
  const runtime = new RoomRuntime(db.store, definition, { model }, { harness: { clock: { now: () => now } } });
  try {
    await db.store.migrate(); const created = await ready(runtime);
    await runtime.tick(created.id);
    let room = await runtime.inspect(created.id);
    assert.equal(room.phase?.key, 'step-1');
    assert.equal(room.phaseDeadlineAt, created.phaseDeadlineAt);
    assert.equal(model.calls.length, 1);
    now = created.phaseDeadlineAt! - 5_000;
    await runtime.tick(created.id);
    room = await runtime.inspect(created.id);
    assert.equal(room.phase?.key, 'step-2');
    assert.equal(model.calls.length, 1);
    assert.deepEqual((room.state as unknown as State).origins, ['default', 'default']);
  } finally { await runtime.close(); await db.stop(); }
});

test('TB-WG03/09: opt-out retains deadline fallback; private events can stay private after finish', async () => {
  const db = await startTestDatabase(); let now = 1_000;
  const model = new ScriptedModel(() => { throw new HarnessError('MODEL_UNAVAILABLE'); });
  const definition = staged({ ...({ revealEvent: (event: { type: string }) => event.type !== 'secret' } as object) });
  const runtime = new RoomRuntime(db.store, definition, { model }, { harness: { clock: { now: () => now } } });
  try {
    await db.store.migrate(); const created = await ready(runtime);
    await runtime.tick(created.id);
    assert.equal((await runtime.inspect(created.id)).phase?.key, 'step-0');
    await db.store.pool.query(`UPDATE tb_rooms SET document=jsonb_set(jsonb_set(jsonb_set(document,'{status}','"finished"'),
      '{phase}','null'),'{events}',$2::jsonb) WHERE id=$1`, [created.id, JSON.stringify([
      { sequence: 1, phaseInstance: 1, type: 'secret', audience: [1], data: 'private-discussion' },
      { sequence: 2, phaseInstance: 1, type: 'public', audience: 'public', data: 'public-fact' },
    ])]);
    const view = await runtime.spectate(created.id);
    assert.equal(JSON.stringify(view).includes('private-discussion'), false);
    assert.equal(JSON.stringify(view).includes('public-fact'), true);
  } finally { await runtime.close(); await db.stop(); }
});

test('TB-WG08: host transaction failure rolls back and blocks; it cannot masquerade as controller fallback', async () => {
  const db = await startTestDatabase();
  const model = new ScriptedModel(() => '{"kind":"go"}');
  const runtime = new RoomRuntime(db.store, staged({ fallbackOnFailure: () => true }), { model }, {
    harness: { clock: { now: () => 1_000 }, hook: async phase => { if (phase === 'host') throw new Error('injected-transaction-failure'); } },
  });
  try {
    await db.store.migrate(); const created = await ready(runtime);
    await runtime.tick(created.id);
    const room = await runtime.inspect(created.id);
    assert.equal(room.status, 'blocked');
    assert.equal(room.error, 'INTERNAL_ERROR');
    assert.equal((room.state as unknown as State).step, 0);
    assert.equal(room.decisions.length, 0);
    assert.equal(room.events.length, 0);
    assert.equal(model.calls.length, 1);
  } finally { await runtime.close(); await db.stop(); }
});

test('TB-WG08: a scripted controller cannot hide an exception in the trusted resolver with a default', async () => {
  const db = await startTestDatabase();
  const definition = staged({ fallbackOnFailure: () => true,
    resolve: () => { throw new Error('trusted-resolver-fault'); },
    decisionSpec: (room, seat) => ({ actor: { roomId: room.id, seat, phaseInstance: room.phaseInstance },
      scene: room.phase!.key, intent: 'SELECT', options: [{ id: 'go', value: { kind: 'go' } }], outputSchema: {},
      context: { rules: {}, game_state: {}, self: { seat, name: 'Test', role: null }, private_information: {},
        public_history: [], current_action: { request_type: 'SELECT', scene: room.phase!.key, options: [], phaseInstance: room.phaseInstance } } }),
    decodeDecision: () => ({ kind: 'go' }),
  });
  const runtime = new RoomRuntime(db.store, definition, { model: { decide: async () => ({ kind: 'proposal', value: { selected: 'go' } }) } },
    { harness: { clock: { now: () => 1_000 } } });
  try {
    await db.store.migrate(); const created = await ready(runtime);
    await runtime.tick(created.id);
    const room = await runtime.inspect(created.id);
    assert.equal(room.status, 'blocked');
    assert.equal(room.error, 'INTERNAL_ERROR');
    assert.equal(room.decisions.length, 0);
    assert.equal(room.events.length, 0);
  } finally { await runtime.close(); await db.stop(); }
});
