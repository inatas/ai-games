import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRoom, occupySeat, acceptDecision, actorView, spectatorView,
  type RoomDefinition, type Room, type Phase,
} from '../src/index.ts';

const phase = (mode: 'sequential' | 'sealed'): Phase => ({
  key: 'choose', label: '选择', round: 1, mode, actors: [1, 2],
  schema: { type: 'object', additionalProperties: false, required: ['choice'], properties: { choice: { type: 'string', enum: ['A', 'B'] } } },
});
const definition: RoomDefinition = {
  id: 'neutral', version: '1', seats: 2, instructions: 'Choose independently.',
  initialize: () => ({ state: { secret: 'vault-42' }, phase: phase('sealed'), events: [
    { type: 'notice', audience: 'public', data: 'public announcement' },
    { type: 'private', audience: [1], data: 'seat-one-only' },
  ] }),
  project: (_state, viewer) => viewer === 1 ? { clue: 'own-clue' } : { clue: null },
  validate: (_state, _phase, _seat, decision) => (decision as { choice: string }).choice !== 'B',
  onDecision: (_state, _phase, seat, decision) => [{ type: 'speech', audience: 'public', data: { seat, decision } }],
  resolve: (state, _phase, decisions) => ({ state, result: { count: decisions.length }, events: [] }),
  reveal: state => state,
};
function ready(def = definition): Room {
  let room = createRoom('room-1', 'run-1', def);
  room = occupySeat(room, { seat: 1, name: 'First', modelProfile: 'model-a', scopeId: 'scope-1', interruptScopeId: 'interrupt-1' }, def);
  return occupySeat(room, { seat: 2, name: 'Second', modelProfile: 'model-b', scopeId: 'scope-2', interruptScopeId: 'interrupt-2' }, def);
}

test('TB-01: seats gate automatic start and repeated occupancy is idempotent', () => {
  let room = createRoom('room-1', 'run-1', definition);
  assert.equal(room.status, 'waiting');
  const seat = { seat: 1, name: 'First', modelProfile: 'model-a', scopeId: 'scope-1', interruptScopeId: 'interrupt-1' };
  room = occupySeat(room, seat, definition);
  assert.equal(room.status, 'waiting');
  assert.deepEqual(occupySeat(room, seat, definition), room);
  assert.throws(() => occupySeat(room, { ...seat, name: 'Changed' }, definition), /SEAT_CONFLICT/);
  assert.throws(() => occupySeat(room, { ...seat, seat: 3 }, definition), /INVALID_SEAT/);
  assert.throws(() => occupySeat(room, { ...seat, seat: 2 }, definition), /SCOPE_CONFLICT/);
  assert.equal(ready().status, 'running');
  assert.throws(() => createRoom('r', 'k', { ...definition, seats: 0 }), /INVALID_DEFINITION/);
});

test('TB-02: invalid phase, wrong actor, malformed output and rejected action leave input unchanged', () => {
  const room = ready();
  const before = structuredClone(room);
  assert.throws(() => acceptDecision(room, 99, 1, { choice: 'A' }, definition), /PHASE_CONFLICT/);
  assert.throws(() => acceptDecision(room, 1, 3, { choice: 'A' }, definition), /ACTOR_NOT_ELIGIBLE/);
  assert.throws(() => acceptDecision(room, 1, 1, { choice: 'C' }, definition), /INVALID_DECISION/);
  assert.throws(() => acceptDecision(room, 1, 1, { choice: 'B' }, definition), /RULE_REJECTED/);
  assert.deepEqual(room, before);
});

test('TB-03/04: sealed decisions never reach another actor or spectator before completion', () => {
  const room = ready();
  const actorBefore = actorView(room, 2, definition);
  const partial = acceptDecision(room, 1, 1, { choice: 'A' }, definition);
  assert.deepEqual(actorView(partial, 2, definition), actorBefore);
  assert.doesNotMatch(JSON.stringify(spectatorView(partial, definition)), /vault-42|seat-one-only|own-clue|choice|scope-|model-/);
  assert.match(JSON.stringify(actorView(partial, 1, definition)), /seat-one-only|own-clue/);
  const ended = acceptDecision(partial, 1, 2, { choice: 'A' }, definition);
  assert.equal(ended.status, 'finished');
  assert.match(JSON.stringify(spectatorView(ended, definition)), /vault-42/);
  assert.match(JSON.stringify(spectatorView(ended, definition)), /seat-one-only/);
  assert.doesNotMatch(JSON.stringify(actorView(ended, 2, definition)), /vault-42|seat-one-only/);
  assert.throws(() => acceptDecision(ended, 1, 2, { choice: 'A' }, definition), /ROOM_NOT_RUNNING/);
});

test('TB-02/03: sequential speech exposes committed public text only in actor order', () => {
  const def = { ...definition, initialize: () => ({ state: {}, phase: phase('sequential') }) };
  const room = ready(def);
  assert.throws(() => acceptDecision(room, 1, 2, { choice: 'A' }, def), /ACTOR_NOT_ELIGIBLE/);
  const first = acceptDecision(room, 1, 1, { choice: 'A' }, def);
  assert.match(JSON.stringify(actorView(first, 2, def)), /speech/);
  assert.throws(() => acceptDecision(first, 1, 1, { choice: 'A' }, def), /ACTOR_NOT_ELIGIBLE/);
});

test('TB-07: repeated phase keys get new instances and finite budget aborts without reveal', () => {
  const def: RoomDefinition = { ...definition, resolve: state => ({ state, phase: phase('sealed') }) };
  let room = ready(def);
  room.limits.maxPhases = 2;
  for (let instance = 1; instance <= 2; instance++) {
    room = acceptDecision(room, instance, 1, { choice: 'A' }, def);
    room = acceptDecision(room, instance, 2, { choice: 'A' }, def);
  }
  assert.equal(room.status, 'aborted');
  assert.doesNotMatch(JSON.stringify(spectatorView(room, def)), /vault-42|seat-one-only/);
});

test('TB-04/07: blocked and aborted do not reveal; invalid game plans and event audiences fail closed', () => {
  for (const status of ['blocked', 'aborted'] as const) {
    const room = { ...ready(), status };
    assert.doesNotMatch(JSON.stringify(spectatorView(room, definition)), /vault-42|seat-one-only/);
  }
  for (const actors of [[], [1, 1], [3]]) {
    assert.throws(() => ready({ ...definition, initialize: () => ({ state: {}, phase: { ...phase('sealed'), actors } }) }), /INVALID_PHASE/);
  }
  assert.throws(() => ready({ ...definition, initialize: () => ({ state: {}, phase: phase('sealed'), events: [{ type: 'secret', audience: [3], data: 'secret' }] }) }), /INVALID_EVENT/);
});
