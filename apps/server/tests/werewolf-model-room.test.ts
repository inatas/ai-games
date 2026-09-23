import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadRobotUsers } from '../src/robot-users.ts';
import { setupRobotRoom } from '../src/werewolf-model-room.ts';

test('one model and eleven scripts are seated as distinct Robot users with their fixed persona', async () => {
  const users = loadRobotUsers();
  const roster = [users.find(user => user.control.kind === 'model')!, ...users.filter(user => user.control.kind === 'script').slice(0, 11)];
  const seats: unknown[] = [];
  const runtime = {
    async create(key: string, _limits: object, signature: string) {
      assert.equal(key, 'run-1');
      assert.equal(signature, createHash('sha256').update(JSON.stringify(roster.map(user => user.userId))).digest('hex'));
      return { id: 'room-1' };
    },
    async seat(_roomId: string, config: unknown) { seats.push(config); return {} as never; },
  };
  assert.equal(await setupRobotRoom(runtime, 'run-1', roster), 'room-1');
  assert.equal(seats.length, 12);
  assert.deepEqual((seats[0] as { userId: string; persona: string; modelProfile: string }), {
    seat: 1, userId: roster[0].userId, name: roster[0].nickname,
    persona: roster[0].persona.description, modelProfile: 'environment-default',
  });
  await assert.rejects(() => setupRobotRoom(runtime, 'run-2', roster.slice(0, 11)), /INVALID_ROSTER/);
});

test('replayed start keeps the already running room profile snapshot', async () => {
  const users = loadRobotUsers();
  const roster = [users.find(user => user.control.kind === 'model')!, ...users.filter(user => user.control.kind === 'script').slice(0, 11)];
  let seating = 0;
  const runtime = {
    async create() { return { id: 'existing', status: 'running', seats: roster.map((user, index) => ({ seat: index + 1, userId: user.userId })) }; },
    async seat() { seating++; return {}; },
  };
  assert.equal(await setupRobotRoom(runtime, 'same-key', roster), 'existing');
  assert.equal(seating, 0);
});
