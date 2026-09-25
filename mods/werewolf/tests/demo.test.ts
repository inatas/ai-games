import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DemoRooms } from '../src/demo.ts';
import { demoClock } from './demo-clock.ts';

test('UI-02/03: host-driven seeded demo finishes reproducibly with complete replay', () => {
  const clock = demoClock();
  let game = clock.rooms.create(42, 'random');
  assert.deepEqual(clock.rooms.get(game.id), game);
  game = clock.finish(game.id);
  assert.equal(game.status, 'finished');
  assert.equal(game.roles?.length, 12);
  assert.ok(game.replay?.length);
  assert.ok(game.replay!.filter(frame => frame.events.some(event => event.type === 'wolf-choices')).every(frame => frame.period === 'night'));
  assert.ok(game.events.every(event => !['decision', 'interrupt'].includes(event.type)));
  assert.ok(game.replay!.every(frame => frame.events.every(event => !['decision', 'interrupt'].includes(event.type))));
  const repeat = clock.finish(clock.rooms.create(42, 'random').id);
  assert.deepEqual(repeat.result, game.result);
  assert.deepEqual(repeat.events, game.events);
});

test('UI-04: running snapshot contains no private state or future replay; unknown rooms rejected', () => {
  const rooms = new DemoRooms();
  const game = rooms.create(42, 'fixed');
  assert.equal(game.period, 'night');
  assert.equal(game.actor, null);
  assert.equal(game.speakerSeat, null);
  assert.equal(game.progress, null);
  assert.equal(game.roles, undefined);
  assert.equal(game.replay, undefined);
  assert.doesNotMatch(JSON.stringify(game), /scopeId|inspection|antidote|modelProfile|knife|role|decisionEpoch/);
  assert.throws(() => rooms.get('not-a-session'), /DEMO_NOT_FOUND/);
  assert.throws(() => rooms.create(-1, 'random'), /INVALID/);
  assert.throws(() => rooms.create(1, 'unknown' as 'random'), /INVALID/);
});

test('UI-02/04: fixed/random runs finish; night segments and deaths cannot reveal private actors', () => {
  for (const strategy of ['fixed', 'random'] as const) {
    const clock = demoClock();
    let game = clock.rooms.create(42, strategy);
    let steps = 0;
    while (game.status === 'running' && steps++ < 600) {
      if (game.period === 'night') {
        assert.equal(game.actor, null);
        assert.equal(game.speakerSeat, null);
        assert.equal(game.progress, null);
        assert.equal(game.timing.remainingMs, game.nightSegment === 'shared' ? 90_000 : 30_000);
      }
      if (game.phaseLabel === '警长退水') {
        assert.equal(game.actor, null);
        assert.equal(game.timing.remainingMs, 10_000);
      }
      assert.equal(game.roles, undefined);
      assert.equal(game.replay, undefined);
      game = clock.advance(game.id);
    }
    assert.equal(game.status, 'finished');
    assert.ok(steps < 600);
  }
});

test('current speech belongs to the live speaker and disappears outside speech', () => {
  const clock = demoClock('第一行\n第二行');
  let game = clock.rooms.create(22, 'random');
  let speakers = new Set<number>();
  for (let i = 0; i < 400 && game.status === 'running'; i++) {
    if (game.speakerSeat !== null) {
      assert.deepEqual(game.currentSpeech, { seat: game.speakerSeat, text: '第一行\n第二行', revision: game.revision });
      speakers.add(game.speakerSeat);
    } else assert.equal(game.currentSpeech, null);
    game = clock.advance(game.id);
  }
  assert.ok(speakers.size > 1);
  assert.equal(game.status, 'finished');
  assert.equal(game.currentSpeech, null);
});
