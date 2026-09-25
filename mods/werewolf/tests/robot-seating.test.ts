import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWerewolfDemo } from '../server/werewolf-demo.ts';

test('RR-05: catalog disables model users without service while standalone script demo remains available', async () => {
  const app = await buildWerewolfDemo();
  try {
    const catalog = await app.inject('/api/robot-users');
    assert.equal(catalog.statusCode, 200);
    const users = catalog.json();
    assert.equal(users.length, 13);
    assert.equal(new Set(users.map((u: any) => u.userId)).size, users.length);
    assert.ok(users.every((u: any) => !u.control && !u.persona));
    assert.equal(users.filter((u: any) => u.available).length, 1);
    const payload = { requestId: 'seating-test-0001', seed: 22, userIds: users.slice(0, 12).map((u: any) => u.userId) };
    for (const ids of [payload.userIds.slice(1), [...payload.userIds.slice(1), payload.userIds[1]], [...payload.userIds.slice(1), 'unknown']]) {
      assert.equal((await app.inject({method:'POST',url:'/api/werewolf/demo/start',payload:{...payload,userIds:ids}})).statusCode,400);
    }
    assert.equal((await app.inject({method:'POST',url:'/api/werewolf/demo/start',payload})).statusCode,400);
    const standalone = await app.inject({method:'POST',url:'/api/werewolf/demo',payload:{seed:22,strategy:'random'}});
    assert.equal(standalone.statusCode,200);
    assert.equal(standalone.json().status,'running');
  } finally { await app.close(); }
});

import { loadRobotUsers, validateRobotUsers } from '../server/robot-users.ts';
import { fillRobotSeats } from '../shared/robot-seating.ts';
import { demoClock } from './demo-clock.ts';

test('Robot catalog rejects duplicate identity and unsupported controllers; fill preserves occupied seats', () => {
  const users = loadRobotUsers();
  assert.throws(() => validateRobotUsers([users[0], users[0]]), /DUPLICATE/);
  assert.throws(() => validateRobotUsers([{ ...users[0], control: { kind: 'model' } }]), /INVALID/);
  const seats: (string | null)[] = Array(12).fill(null);
  seats[4] = users[0].userId;
  const available = users.map(user => ({ ...user, available: true }));
  const filled = fillRobotSeats(seats, available, () => 0.5);
  assert.equal(filled[4], users[0].userId);
  assert.equal(new Set(filled).size, 12);
  assert.equal(seats.filter(Boolean).length, 1);
  assert.deepEqual(fillRobotSeats(filled, available), filled);
  const disabled = fillRobotSeats(Array(12).fill(null), users.map(user => ({ ...user, available: user.control.kind === 'script' })));
  assert.equal(disabled.filter(Boolean).length, 1);
});

test('Robot roster remains attached to users through a full game and owns each fixed speech', () => {
  const scriptControl = loadRobotUsers().find(user => user.control.kind === 'script')!.control as Extract<ReturnType<typeof loadRobotUsers>[number]['control'], {kind: 'script'}>;
  const users = loadRobotUsers().slice(0, 12).map(user => ({ ...user, control: structuredClone(scriptControl) })).reverse();
  users.forEach(user => { user.control.speech = `我是${user.nickname}`; });
  const clock = demoClock();
  let game = clock.rooms.create(22, 'random', users);
  const originalName = users[0].nickname;
  users[0].nickname = 'changed after start';
  assert.equal((clock.rooms.get(game.id).players[0] as {user?: {nickname:string}}).user?.nickname, originalName);
  game = clock.finish(game.id);
  assert.equal(game.status, 'finished');
  assert.ok(game.speeches.length);
  for (const speech of game.speeches) assert.equal(speech.text, users[speech.seat - 1].control.speech);
  assert.deepEqual(game.players.map(player => 'user' in player ? player.user.userId : undefined), users.map(user => user.userId));
});


test('Model Robot config loads but cannot enter a script game or random fill', async () => {
  const users = loadRobotUsers();
  const model = users.find(user => user.control.kind === 'model');
  assert.ok(model, 'catalog must contain a model-configured Robot');
  assert.equal(model.control.modelProfile, 'environment-default');
  assert.throws(() => validateRobotUsers([{ ...model, control: { kind: 'model', modelProfile: 'unknown' } }]), /PROFILE/);
  assert.throws(() => validateRobotUsers([{ ...model, control: { kind: 'model', modelProfile: 'environment-default', apiKey: 'not-allowed' } }]), /INVALID/);
  const script = users.filter(user => user.control.kind === 'script');
  assert.equal(script.length, 1);
  const syntheticScripts = users.slice(1, 12).map(user => ({ ...user, control: script[0].control }));
  assert.throws(() => demoClock().rooms.create(42, 'random', [...syntheticScripts, model]), /MODEL_ROBOT_NOT_READY/);
  const app = await buildWerewolfDemo();
  try {
    const catalog = (await app.inject('/api/robot-users')).json();
    const entry = catalog.find((user: any) => user.userId === model.userId);
    assert.equal(entry.available, false);
    assert.equal(entry.unavailableReason, '模型服务未配置');
    assert.doesNotMatch(JSON.stringify(catalog), /modelProfile|MODEL_API_KEY|baseUrl|persona/);
    const filled = fillRobotSeats(Array(12).fill(null), catalog, () => 0);
    assert.equal(filled.includes(model.userId), false);
    assert.equal(filled.filter(Boolean).length, 1);
    const response = await app.inject({ method: 'POST', url: '/api/werewolf/demo/start', payload: {
      requestId: 'model-config-only', seed: 42, userIds: users.slice(0, 12).map(user => user.userId),
    } });
    assert.equal(response.statusCode, 400);
    assert.match(response.json().error, /模型/);
  } finally { await app.close(); }
});
