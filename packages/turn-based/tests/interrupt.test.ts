import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, occupySeat, acceptDecision, acceptInterrupt, spectatorView } from '../src/index.ts';
import { interruptGame } from '../../../tests/support/interrupt-game.ts';

function ready() {
  let room = createRoom('interrupt-room', 'run', interruptGame);
  for (let seat = 1; seat <= 2; seat++) room = occupySeat(room, {
    seat, name: `Seat ${seat}`, modelProfile: 'model', scopeId: `normal-${seat}`, interruptScopeId: `interrupt-${seat}`,
  }, interruptGame);
  return room;
}
test('TB-09/10: interrupt discards collected choices, advances epoch and protects hidden eligibility', () => {
  const room = acceptDecision(ready(), 1, 1, { choice: 'A' }, interruptGame);
  assert.equal(room.decisionEpoch, 1);
  const next = acceptInterrupt(room, 1, 2, { kind: 'replace' }, interruptGame);
  assert.equal(next.phaseInstance, 2);
  assert.equal(next.decisionEpoch, 2);
  assert.deepEqual(next.decisions, []);
  assert.equal(room.decisions.length, 1);
  assert.doesNotMatch(JSON.stringify(spectatorView(next, interruptGame)), /interruptScopeId|first-seat-secret/);
  assert.throws(() => acceptInterrupt(next, 1, 2, { kind: 'replace' }, interruptGame), /PHASE_CONFLICT/);
});
test('TB-09/13: pass is not a public action; invalid eligibility and extra fields are rejected', () => {
  const room = ready();
  assert.deepEqual(acceptInterrupt(room, 1, 2, { kind: 'pass' }, interruptGame), room);
  assert.throws(() => acceptInterrupt(room, 1, 3, { kind: 'replace' }, interruptGame), /ACTOR_NOT_ELIGIBLE/);
  assert.throws(() => acceptInterrupt(room, 1, 2, { kind: 'replace', seat: 1 }, interruptGame), /INVALID_DECISION/);
  room.phase!.interrupt = undefined;
  assert.throws(() => acceptInterrupt(room, 1, 2, { kind: 'replace' }, interruptGame), /ACTOR_NOT_ELIGIBLE/);
});
