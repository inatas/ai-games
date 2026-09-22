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

test('WD-04/05: speech history and game result are identical under fine and delayed host ticks', async () => {
  const { demoClock } = await import('./demo-clock.ts');
  const clock = demoClock();
  let game = clock.rooms.create(42, 'random');
  for (let i = 0; game.status === 'running' && i < 600; i++) game = clock.advance(game.id);
  assert.equal(game.status, 'finished');
  assert.ok(game.speeches.length > 0);
  assert.ok(game.speeches.every(s => s.text === '我是狼人杀玩家' && s.day > 0));
  assert.ok(game.speeches.some(s => s.phase === '遗言'));
  assert.ok(game.speeches.every((s, i, all) => i === 0 || s.sequence > all[i - 1].sequence));
  const coarse = demoClock();
  const repeat = coarse.finish(coarse.rooms.create(42, 'random').id);
  assert.deepEqual(game.events, repeat.events);
  assert.deepEqual(game.speeches, repeat.speeches);
});

test('WD-06: fixed speech configuration validates length and appears in actual history', async () => {
  const { demoClock } = await import('./demo-clock.ts');
  const clock = demoClock('这是一句配置发言');
  const game = clock.finish(clock.rooms.create(42, 'fixed').id);
  assert.equal(game.speeches[0].text, '这是一句配置发言');
  assert.throws(() => new DemoRooms({speechText:''}), /INVALID_DEMO_SPEECH/);
  assert.throws(() => new DemoRooms({speechText:'长'.repeat(301)}), /INVALID_DEMO_SPEECH/);
});
