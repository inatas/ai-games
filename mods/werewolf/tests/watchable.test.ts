import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, decideMatch, matchPhase } from '../src/match.ts';
import { DemoRooms } from '../src/demo.ts';

test('WD-01: wolves and seer share a sealed phase; medicine follows locked knife', () => {
  let state = createMatch({ seed: 42, sheriff: 'none' });
  const seer = state.game.players.find(p => p.role === 'seer')!.seat;
  const wolves = state.game.players.filter(p => p.role === 'wolf').map(p => p.seat);
  const target = state.game.players.find(p => p.role === 'villager')!.seat;
  assert.deepEqual(new Set(matchPhase(state)!.actors), new Set([...wolves, seer]));
  assert.equal(matchPhase(state)!.mode, 'sealed');
  assert.throws(() => decideMatch(state, state.revision, seer, { kind: 'knife', target }));
  assert.throws(() => decideMatch(state, state.revision, wolves[0], { kind: 'inspect', target }));
  state = decideMatch(state, state.revision, seer, { kind: 'inspect', target });
  assert.equal(state.stage, 'wolves');
  for (const seat of wolves) state = decideMatch(state, state.revision, seat, { kind: 'knife', target });
  assert.equal(state.stage, 'witch');
  assert.equal(state.knife, target);
  assert.equal(state.game.inspections.length, 1);
  state = decideMatch(state, state.revision, matchPhase(state)!.actors[0], { kind: 'pass' });
  assert.notEqual(state.stage, 'seer');
});

test('WD-02/03: standard clock uses shared 60 then 30, pauses and cannot duplicate steps', () => {
  let now = 0;
  const rooms = new DemoRooms({ now: () => now });
  let game = rooms.create(42, 'random');
  game = rooms.control(game.id, game.revision, true);
  now = 59_999;
  const waiting = rooms.get(game.id);
  assert.equal(waiting.revision, game.revision);
  now = 60_000;
  game = rooms.get(game.id);
  assert.equal(game.period, 'night');
  assert.equal(game.timing.remainingMs, 30_000);
  const revision = game.revision;
  game = rooms.control(game.id, revision, false);
  now += 100_000;
  assert.equal(rooms.get(game.id).timing.remainingMs, 30_000);
  const oldRevision = game.revision;
  game = rooms.step(game.id, oldRevision);
  assert.notEqual(game.period, 'night');
  assert.deepEqual(rooms.step(game.id, oldRevision), game);
});

test('WD-04: actual speech history has day/order/text and survives a complete game', () => {
  const rooms = new DemoRooms();
  let game = rooms.create(42, 'random');
  for (let i = 0; game.status === 'running' && i < 600; i++) game = rooms.step(game.id, game.revision);
  assert.equal(game.status, 'finished');
  assert.ok(game.speeches.length > 0);
  assert.ok(game.speeches.every(s => s.text === '我是狼人杀玩家' && s.day > 0));
  assert.ok(game.speeches.some(s => s.phase === '遗言'));
  assert.ok(game.speeches.every((s, i, all) => i === 0 || s.sequence > all[i - 1].sequence));
  const repeatRooms = new DemoRooms();
  let repeat = repeatRooms.create(42, 'random');
  while (repeat.status === 'running') repeat = repeatRooms.step(repeat.id, repeat.revision);
  assert.deepEqual(game.events, repeat.events);
  assert.deepEqual(game.speeches, repeat.speeches);
});

test('WD-05: automatic clock completes the same game as stepping, including nights without witch', () => {
  let now = 0;
  const rooms = new DemoRooms({ now: () => now });
  let game = rooms.create(42, 'random');
  game = rooms.control(game.id, game.revision, true);
  for (let i = 0; game.status === 'running' && i < 600; i++) {
    if (game.period === 'night') {
      assert.equal(game.timing.remainingMs, 90_000);
      now += 60_000;
      const previous = game.revision;
      game = rooms.get(game.id);
      assert.equal(game.revision, previous + 1);
      assert.equal(game.period, 'night');
      assert.equal(game.timing.remainingMs, 30_000);
      now += 30_000;
    } else now += 3_000;
    game = rooms.get(game.id);
  }
  assert.equal(game.status, 'finished');
  assert.equal(game.playing, false);
  assert.equal(game.timing.remainingMs, 0);
  let manual = rooms.create(42, 'random');
  while (manual.status === 'running') manual = rooms.step(manual.id, manual.revision);
  assert.deepEqual(game.events, manual.events);
  assert.deepEqual(game.speeches, manual.speeches);
});

test('WD-06: control retries do not resume a paused game; custom speech is validated', () => {
  let now = 0;
  const rooms = new DemoRooms({ now: () => now, speechText: '这是一句配置发言' });
  let game = rooms.create(42, 'fixed');
  const initial = game.revision;
  game = rooms.control(game.id, initial, true);
  assert.deepEqual(rooms.control(game.id, initial, true), game);
  now += 12_000;
  game = rooms.control(game.id, game.revision, false);
  assert.equal(game.timing.remainingMs, 78_000);
  assert.throws(() => rooms.control(game.id, initial, true), /REVISION_CONFLICT/);
  while (!game.speeches.length) game = rooms.step(game.id, game.revision);
  assert.equal(game.speeches[0].text, '这是一句配置发言');
  assert.throws(() => new DemoRooms({ speechText: '' }), /INVALID_DEMO_SPEECH/);
  assert.throws(() => new DemoRooms({ speechText: '长'.repeat(301) }), /INVALID_DEMO_SPEECH/);
});
