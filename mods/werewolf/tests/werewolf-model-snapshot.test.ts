import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, occupySeat } from '@game-ai/turn-based';
import { werewolfDefinition } from '../src/definition.ts';
import { loadRobotUsers } from '../server/robot-users.ts';
import { modelRoomSnapshot } from '../server/werewolf-model-snapshot.ts';

test('persistent model-room snapshot is public and keeps its full first-night countdown', () => {
  const definition = werewolfDefinition({ seed: 42, sheriff: 'double' });
  const users = loadRobotUsers();
  let room = createRoom('snapshot-room', 'snapshot-run', definition);
  for (let seat = 1; seat <= 12; seat++) room = occupySeat(room, {
    seat, name: users[seat - 1].nickname, userId: users[seat - 1].userId,
    modelProfile: 'script', scopeId: `scope-${seat}`, interruptScopeId: `interrupt-${seat}`,
  }, definition);
  room.phaseStartedAt = 1_000;
  room.phaseActionDeadlineAt = 61_000;
  room.phaseDeadlineAt = 61_000;
  const snapshot = modelRoomSnapshot(room, definition, users, 2_000);
  assert.equal(snapshot.period, 'night');
  assert.equal(snapshot.timing.remainingMs, 59_000);
  assert.equal(snapshot.players.length, 12);
  assert.equal(snapshot.speakerSeat, null);
  assert.ok(!JSON.stringify(snapshot).includes('modelProfile'));
  assert.ok(!JSON.stringify(snapshot).includes('scope-1'));
  const seatView = modelRoomSnapshot(room, definition, users, 2_000, 1);
  assert.equal(seatView.perspective?.kind, 'seat');
  assert.equal(snapshot.perspective?.kind, 'public');
  assert.equal(seatView.events.length, snapshot.events.length);
  (room.state as { stage: string }).stage = 'speech';
  room.phase = { ...room.phase!, key: 'speech', mode: 'sequential', actors: [1] };
  room.decisions = [{ seat: 1, value: { kind: 'speak', text: '我是狼人杀玩家' } }];
  room.phaseEarlyFinishAt = 5_000;
  const speaking = modelRoomSnapshot(room, definition, users, 3_000);
  assert.equal(speaking.timing.remainingMs, 2_000);
  assert.equal(speaking.currentSpeech?.text, '我是狼人杀玩家');
});
