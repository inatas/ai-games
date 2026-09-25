import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadRobotUsers } from '../server/robot-users.ts';
import { setupRobotRoom } from '../server/werewolf-model-room.ts';

test('RR-01/02: twelve model users keep distinct identities and persona when seated', async () => {
  const users = loadRobotUsers();
  assert.equal(users.length, 13);
  assert.ok(users.slice(0, 12).every(user => user.control.kind === 'model' && user.control.modelProfile === 'environment-default'));
  assert.equal(users[12].control.kind, 'script');
  const roster = users.slice(0, 12);
  const seats: unknown[] = [];
  const runtime = {
    async create(key: string, _limits: object, signature: string) {
      assert.equal(key, 'run-1');
      assert.equal(signature, createHash('sha256').update(JSON.stringify(roster.map(user =>
        [user.userId, user.control.kind === 'model' ? user.control.modelProfile : `script:${user.userId}`]))).digest('hex'));
      return { id: 'room-1' };
    },
    async seat(_roomId: string, config: unknown) { seats.push(config); return {} as never; },
  };
  assert.equal(await setupRobotRoom(runtime, 'run-1', roster), 'room-1');
  assert.equal(seats.length, 12);
  assert.deepEqual((seats[0] as { userId: string; persona: string; modelProfile: string }), {
    seat: 1, userId: roster[0].userId, name: roster[0].nickname,
    persona: roster[0].persona.description, modelProfile: 'environment-default', controllerKind: 'robot',
  });
  await assert.rejects(() => setupRobotRoom(runtime, 'run-2', roster.slice(0, 11)), /INVALID_ROSTER/);
  await assert.rejects(() => setupRobotRoom(runtime, 'run-3', [...roster.slice(0, 11), roster[0]]), /INVALID_ROSTER/);
});

test('replayed start keeps the already running room profile snapshot', async () => {
  const users = loadRobotUsers();
  const roster = users.slice(0, 12);
  let seating = 0;
  const runtime = {
    async create() { return { id: 'existing', status: 'running', seats: roster.map((user, index) => ({ seat: index + 1, userId: user.userId })) }; },
    async seat() { seating++; return {}; },
  };
  assert.equal(await setupRobotRoom(runtime, 'same-key', roster), 'existing');
  assert.equal(seating, 0);
});

test('RR-03: a model room accepts a mixed roster and rejects an all-script roster', async () => {
  const users = loadRobotUsers();
  const model = users[0];
  const script = users[12];
  const mixed = [...users.slice(0, 11), script];
  const runtime = {
    async create() { return { id: 'mixed' }; },
    async seat() { return {}; },
  };
  assert.equal(await setupRobotRoom(runtime, 'mixed', mixed), 'mixed');
  const allScript = users.slice(0, 12).map(user => ({ ...user, control: script.control }));
  await assert.rejects(() => setupRobotRoom(runtime, 'script-only', allScript), /INVALID_ROSTER/);
  assert.equal(model.control.kind, 'model');
});

test('WW-W02: per-seat profile choices are frozen into seating and idempotency signature', async () => {
  const roster = loadRobotUsers().slice(0, 12);
  const profileIds = roster.map((_user, index) => index === 0 ? 'alternate' : 'environment-default');
  let signature = '';
  const seated: { modelProfile: string }[] = [];
  const runtime = {
    async create(_key: string, _limits: object, value: string) { signature = value; return { id: 'configured' }; },
    async seat(_id: string, seat: { modelProfile: string }) { seated.push(seat); return {}; },
  };
  await setupRobotRoom(runtime, 'configured-key', roster, profileIds);
  assert.equal(seated[0].modelProfile, 'alternate');
  assert.equal(seated[1].modelProfile, 'environment-default');
  assert.equal(signature, createHash('sha256').update(JSON.stringify(roster.map((user, index) =>
    [user.userId, profileIds[index]]))).digest('hex'));
});
