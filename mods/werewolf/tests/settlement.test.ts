import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, exile, kill, settleNight, announceDeaths, type GameState } from '../src/rules.ts';
import { beginSettlement, advanceSettlement } from '../src/settlement.ts';

function game(): GameState {
  const state = createGame(42);
  const roles = ['wolf', 'wolf', 'wolf', 'wolf', 'villager', 'villager',
    'villager', 'villager', 'seer', 'witch', 'hunter', 'idiot'] as const;
  state.players.forEach((p, i) => { p.role = roles[i]; });
  return state;
}

test('WW-58: hunter exile requires last words, shot and target last words; reload cannot repeat shot', () => {
  const original = beginSettlement(exile(game(), 11), [11]);
  assert.deepEqual(original.queue, [{ kind: 'last-words', seat: 11 }, { kind: 'shot', seat: 11 }]);
  const words = advanceSettlement(original, 0, 11, { kind: 'last-words', text: '我带走1号' });
  const shot = advanceSettlement(words, 1, 11, { kind: 'shot', target: 1 });
  assert.equal(shot.game.players[0].alive, false);
  assert.deepEqual(shot.queue, [{ kind: 'last-words', seat: 1 }]);
  const restored = JSON.parse(JSON.stringify(shot));
  assert.throws(() => advanceSettlement(restored, 1, 11, { kind: 'shot', target: 2 }), /REVISION_CONFLICT/);
  assert.throws(() => advanceSettlement(restored, 2, 11, { kind: 'shot', target: 2 }), /WRONG_SETTLEMENT_ACTOR/);
  const done = advanceSettlement(restored, 2, 1, { kind: 'last-words', text: '结束发言' });
  assert.equal(done.complete, true);
  assert.equal(done.result, null);
  assert.equal(done.events.filter(e => e.type === 'hunter-shot').length, 1);
  assert.equal(original.game.players[0].alive, true);
});

test('WW-26,28–31: poison blocks gun, later night skips own last words, passing gun completes chain', () => {
  const poison = beginSettlement(announceDeaths(settleNight({ ...game(), night: 2 }, 11, 11)), [11]);
  assert.equal(poison.complete, true);
  const night = beginSettlement(announceDeaths(settleNight({ ...game(), night: 2 }, 11, null)), [11]);
  assert.deepEqual(night.queue, [{ kind: 'shot', seat: 11 }]);
  const pass = advanceSettlement(night, 0, 11, { kind: 'shot', target: null });
  assert.equal(pass.complete, true);
  const shot = advanceSettlement(night, 0, 11, { kind: 'shot', target: 5 });
  assert.deepEqual(shot.queue, [{ kind: 'last-words', seat: 5 }]);
});

test('WW-75: potential victory waits for last words and badge transfer; gun can change it to a draw', () => {
  let state = game();
  for (const seat of [1, 2, 3, 9, 10, 12]) state = kill(state, seat, 'poison');
  const settlement = beginSettlement(exile({ ...state, sheriff: 11 }, 11), [11]);
  assert.equal(settlement.result, null);
  const words = advanceSettlement(settlement, 0, 11, { kind: 'last-words', text: '开枪' });
  const shot = advanceSettlement(words, 1, 11, { kind: 'shot', target: 4 });
  assert.equal(shot.result, null);
  const targetWords = advanceSettlement(shot, 2, 4, { kind: 'last-words', text: '最后一狼' });
  assert.equal(targetWords.result, null);
  assert.deepEqual(targetWords.queue, [{ kind: 'badge-transfer', seat: 11 }]);
  const done = advanceSettlement(targetWords, 3, 11, { kind: 'badge-transfer', target: 5 });
  assert.equal(done.game.sheriff, 5);
  assert.deepEqual(done.result, { winner: 'draw', reason: 'both-conditions' });
});

test('WW-30,67,71: invalid inputs do not mutate state; self explosion and idiot reveal have no last words', () => {
  const original = beginSettlement(exile(game(), 11), [11]);
  const snapshot = structuredClone(original);
  assert.throws(() => advanceSettlement(original, 0, 11, { kind: 'last-words', text: '字'.repeat(301) }), /INVALID_SPEECH/);
  assert.throws(() => advanceSettlement(original, 0, 11, { kind: 'shot', target: 5 }), /WRONG_SETTLEMENT_ACTION/);
  assert.throws(() => beginSettlement(settleNight(game(), 5, null), [5]), /DEATH_NOT_ANNOUNCED/);
  assert.throws(() => beginSettlement(exile(game(), 12), [12]), /NOT_DEAD/);
  const words = advanceSettlement(original, 0, 11, { kind: 'last-words', text: '字'.repeat(300) });
  assert.throws(() => advanceSettlement(words, 1, 11, { kind: 'shot', target: 11 }), /PLAYER_DEAD/);
  const exploded = beginSettlement(kill({ ...game(), sheriff: 1 }, 1, 'explode'), [1]);
  assert.equal(exploded.complete, true);
  assert.equal(exploded.game.sheriff, null);
  assert.deepEqual(original, snapshot);
});
