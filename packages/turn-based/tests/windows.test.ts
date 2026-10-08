import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptDecision, createRoom, occupySeat, startPhaseWindow, type RoomDefinition } from '../src/index.ts';

const definition: RoomDefinition = {
  id: 'neutral-window', version: '1', seats: 2, instructions: 'Return go.',
  initialize: () => ({ state: {}, phase: { key: 'first', label: 'First', round: 1,
    windowGroup: 'group', mode: 'sealed', actors: [1, 2], schema: { type: 'object', additionalProperties: false,
      required: ['kind'], properties: { kind: { const: 'go' } } } } }),
  project: () => ({}), validate: () => true, resolve: () => ({ state: {}, result: 'done' }), windowMs: () => 45_000,
};
function ready() {
  let room = createRoom('window-test', 'window-test', definition);
  for (let seat = 1; seat <= 2; seat++) room = occupySeat(room,
    { seat, name: `${seat}`, modelProfile: 'model', scopeId: `${seat}`, interruptScopeId: `i${seat}` }, definition);
  return room;
}

test('TB-WG01/02: same group cannot change duration and leaving it starts a new ordinary window', () => {
  const room = ready();
  startPhaseWindow(room, definition, 1_000, 0);
  room.phaseInstance++;
  assert.throws(() => startPhaseWindow(room, { ...definition, windowMs: () => 46_000 }, 9_000, 1));
  assert.equal(room.windowGroup!.deadlineAt, 46_000);
  delete room.phase!.windowGroup;
  startPhaseWindow(room, definition, 9_000, 1);
  assert.equal(room.windowGroup, undefined);
  assert.equal(room.phaseDeadlineAt, 54_000);
});

test('TB-WG06: trusted entry records origin; extra model action fields cannot spoof it', () => {
  for (const origin of ['model', 'script', 'rule', 'default', 'external'] as const) {
    const room = acceptDecision(ready(), 1, 1, { kind: 'go' }, definition, origin);
    assert.equal(room.decisions[0].origin, origin);
    assert.equal((room.events[0].data as { origin: string }).origin, origin);
  }
  assert.throws(() => acceptDecision(ready(), 1, 1, { kind: 'go', origin: 'model' }, definition));
  assert.throws(() => acceptDecision(ready(), 1, 1, { kind: 'go' }, definition, 'forged' as never));
});
