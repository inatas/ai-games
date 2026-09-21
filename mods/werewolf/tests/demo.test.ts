import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DemoRooms } from '../src/demo.ts';

test('UI-02/03: seeded silent demo completes, repeated revision cannot duplicate a decision', () => {
  const rooms = new DemoRooms();
  let game = rooms.create(42, 'random');
  const initial = game;
  game = rooms.step(game.id, game.revision);
  assert.deepEqual(rooms.step(game.id, initial.revision), game);
  assert.throws(() => rooms.step(game.id, game.revision + 2), /REVISION_CONFLICT/);
  for (let i = 0; game.status === 'running' && i < 600; i++) game = rooms.step(game.id, game.revision);
  assert.equal(game.status, 'finished');
  assert.ok(game.roles?.length === 12);
  assert.ok(game.replay?.length);
  assert.ok(game.replay!.filter(frame => frame.events.some(event => event.type === 'wolf-choices')).every(frame => frame.period === 'night'));
  assert.ok(game.events.every(event => !['decision', 'interrupt'].includes(event.type)));
  assert.ok(game.replay!.every(frame => frame.events.every(event => !['decision', 'interrupt'].includes(event.type))));
  assert.ok(game.events.filter(e => ['speech', 'last-words', 'sheriff-speech'].includes(e.type)).every(e => (e.data as {text:string}).text === ''));
  let repeat = rooms.create(42, 'random');
  while (repeat.status === 'running') repeat = rooms.step(repeat.id, repeat.revision);
  assert.deepEqual(repeat.result, game.result);
  assert.deepEqual(repeat.events, game.events);
});

test('UI-04: no private state or future replay in running snapshots; unknown rooms rejected', () => {
  const rooms = new DemoRooms();
  const game = rooms.create(42, 'fixed');
  assert.equal(game.period, 'night');
  assert.equal(game.actor, null);
  assert.equal(game.progress, null);
  assert.equal(game.roles, undefined);
  assert.equal(game.replay, undefined);
  assert.doesNotMatch(JSON.stringify(game), /scopeId|inspection|antidote|modelProfile|knife|role|decisionEpoch/);
  assert.throws(() => rooms.get('not-a-session'), /DEMO_NOT_FOUND/);
  assert.throws(() => rooms.create(-1, 'random'), /INVALID/);
  assert.throws(() => rooms.create(1, 'unknown' as 'random'), /INVALID/);
});

test('UI-02/04: fixed and random runs finish within the demo budget and never disclose a night actor', () => {
  for (const strategy of ['fixed', 'random'] as const) {
    const rooms = new DemoRooms();
    let game = rooms.create(42, strategy);
    let steps = 0;
    while (game.status === 'running' && steps++ < 600) {
      if (game.period === 'night') { assert.equal(game.actor, null); assert.equal(game.progress, null); }
      assert.equal(game.roles, undefined);
      assert.equal(game.replay, undefined);
      game = rooms.step(game.id, game.revision);
    }
    assert.equal(game.status, 'finished');
    assert.ok(steps < 600);
  }
});
