import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, settleNight, kill, type GameState } from '../src/rules.ts';
import { beginElection, advanceElection, explodeElection, resumeElection, type Election } from '../src/election.ts';
import { beginSettlement, advanceSettlement } from '../src/settlement.ts';

function game(): GameState {
  const state = createGame(42);
  const roles = ['wolf', 'wolf', 'wolf', 'wolf', 'villager', 'villager',
    'villager', 'villager', 'seer', 'witch', 'hunter', 'idiot'] as const;
  state.players.forEach((p, i) => { p.role = roles[i]; });
  return state;
}
function speakAll(source: Election): Election {
  let state = source;
  while (state.stage === 'speech' || state.stage === 'pk') {
    state = advanceElection(state, state.revision, state.pending[0], { kind: 'speak', text: '竞选发言' });
  }
  return state;
}
function keepAll(source: Election): Election {
  let state = source;
  while (state.stage === 'withdrawal') {
    state = advanceElection(state, state.revision, state.pending[0], { kind: 'withdraw', withdraw: false });
  }
  return state;
}
function voteAll(source: Election, targets: (number | null)[]): Election {
  let state = source;
  for (const target of targets) state = advanceElection(state, state.revision, state.pending[0], { kind: 'vote', target });
  return state;
}

test('WW-32,57,72,76: night deaths still nominate; election finishes before death announcement, ballots stay private', () => {
  const initial = beginElection(settleNight(game(), 9, 10), [9, 10]);
  assert.equal(initial.game.players[8].death?.announced, false);
  const voting = keepAll(speakAll(initial));
  assert.equal(voting.pending.length, 10);
  const first = advanceElection(voting, voting.revision, 1, { kind: 'vote', target: 9 });
  assert.equal(first.events.filter(e => e.type === 'sheriff-result').length, 0);
  const done = voteAll(first, Array(9).fill(9));
  assert.equal(done.stage, 'finished');
  assert.equal(done.game.sheriff, 9);
  assert.deepEqual(done.deaths, [9, 10]);
  assert.equal(done.game.players[8].death?.announced, true);
  assert.ok(done.events.filter(e => e.type === 'sheriff-ballot').every(e => e.audience === 'after-game'));
  const publicEvents = done.events.filter(e => e.audience === 'public');
  assert.equal(publicEvents.some(e => e.type === 'sheriff-ballot'), false);
  assert.ok(publicEvents.findIndex(e => e.type === 'sheriff-result') < publicEvents.findIndex(e => e.type === 'night-deaths'));
});

test('sheriff vote summary becomes public once per completed round, never during ballots', () => {
  const voting = keepAll(speakAll(beginElection(game(), [9, 10])));
  const first = advanceElection(voting, voting.revision, voting.pending[0], { kind: 'vote', target: 9 });
  assert.equal(first.events.some(event => event.type === 'sheriff-votes'), false);
  const pk = voteAll(first, [9, 9, 9, 9, 10, 10, 10, 10, 10]);
  const firstSummary = pk.events.filter(event => event.type === 'sheriff-votes');
  assert.equal(firstSummary.length, 1);
  assert.equal(firstSummary[0].audience, 'public');
  assert.deepEqual((firstSummary[0].data as { tied: number[] }).tied, [9, 10]);
  assert.ok(pk.events.findIndex(event => event.type === 'sheriff-votes') < pk.events.findIndex(event => event.type === 'sheriff-pk'));
  const done = voteAll(speakAll(pk), [9, 9, 9, 9, 9, 10, 10, 10, 10, null]);
  const summaries = done.events.filter(event => event.type === 'sheriff-votes');
  assert.equal(summaries.length, 2);
  assert.deepEqual(summaries.map(event => (event.data as { runoff: boolean }).runoff), [false, true]);
  assert.ok(done.events.findLastIndex(event => event.type === 'sheriff-votes') < done.events.findIndex(event => event.type === 'sheriff-result'));
  assert.equal(beginElection(game(), [9]).events.some(event => event.type === 'sheriff-votes'), false);
});

test('WW-33,65: withdrawal precedes vote, original candidates never acquire voting rights', () => {
  let state = speakAll(beginElection(game(), [1, 9, 10]));
  state = advanceElection(state, state.revision, 1, { kind: 'withdraw', withdraw: true });
  state = keepAll(state);
  assert.equal(state.stage, 'voting');
  assert.equal(state.pending.includes(1), false);
  assert.throws(() => advanceElection(state, state.revision, 1, { kind: 'vote', target: 9 }), /INELIGIBLE_ELECTION_ACTOR/);
  assert.throws(() => advanceElection(state, state.revision, 9, { kind: 'withdraw', withdraw: true }), /WRONG_ELECTION_ACTION/);
  const withdrawing = advanceElection(speakAll(beginElection(game(), [9, 10])), 2, 9, { kind: 'withdraw', withdraw: true });
  assert.equal(withdrawing.stage, 'withdrawal');
  const single = advanceElection(withdrawing, withdrawing.revision, 10, { kind: 'withdraw', withdraw: false });
  assert.equal(single.stage, 'finished');
  assert.equal(single.game.sheriff, 10);
  assert.equal(beginElection(game(), [9]).game.sheriff, 9);
  assert.equal(beginElection(game(), []).game.sheriff, null);
});

test('WW-77,79: shared withdrawal accepts any candidate order and resolves only after everyone decides', () => {
  const initial = speakAll(beginElection(game(), [1, 2, 3]));
  const first = advanceElection(initial, initial.revision, 3, { kind: 'withdraw', withdraw: true });
  assert.equal(first.stage, 'withdrawal');
  assert.deepEqual(first.pending, [1, 2]);
  const second = advanceElection(first, first.revision, 1, { kind: 'withdraw', withdraw: true });
  assert.equal(second.stage, 'withdrawal');
  assert.deepEqual(second.pending, [2]);
  const elected = advanceElection(second, second.revision, 2, { kind: 'withdraw', withdraw: false });
  assert.equal(elected.stage, 'finished');
  assert.equal(elected.game.sheriff, 2);

  let none = initial;
  for (const seat of [2, 1, 3]) none = advanceElection(none, none.revision, seat, { kind: 'withdraw', withdraw: true });
  assert.equal(none.stage, 'finished');
  assert.equal(none.game.sheriff, null);

  const reverse = [1, 3, 2].reduce((state, seat) => advanceElection(state, state.revision, seat,
    { kind: 'withdraw', withdraw: seat !== 2 }), initial);
  assert.equal(reverse.game.sheriff, elected.game.sheriff);
  assert.deepEqual(reverse.candidates, elected.candidates);
});

test('WW-35: tie gets one PK round; second tie or all abstentions loses badge', () => {
  const voting = keepAll(speakAll(beginElection(game(), [9, 10])));
  const pk = voteAll(voting, [9, 9, 9, 9, 9, 10, 10, 10, 10, 10]);
  assert.equal(pk.stage, 'pk');
  assert.deepEqual(pk.pending, [9, 10]);
  const again = speakAll(pk);
  assert.equal(again.stage, 'voting');
  const done = voteAll(again, [9, 9, 9, 9, 9, 10, 10, 10, 10, 10]);
  assert.equal(done.stage, 'finished');
  assert.equal(done.game.sheriff, null);
  assert.equal(voteAll(voting, Array(10).fill(null)).game.sheriff, null);
  const all = beginElection(game(), game().players.map(p => p.seat));
  assert.equal(keepAll(speakAll(all)).stage, 'finished');
});

test('WW-60–62,70: first poisoned wolf explosion preserves nominations across reload/night; second loses badge', () => {
  const night = settleNight({ ...game(), poison: false }, 5, 1);
  const initial = beginElection(night, [1, 2, 9, 10]);
  const first = explodeElection(initial, 0, 1);
  assert.equal(first.stage, 'suspended');
  assert.equal(first.game.sheriff, null);
  assert.deepEqual(first.registered, [1, 2, 9, 10]);
  assert.equal(first.events.some(e => e.type === 'sheriff-result'), false);
  assert.deepEqual(first.deaths, [1, 5]);
  assert.equal(first.game.poison, false);
  assert.throws(() => explodeElection(first, first.revision, 2), /EXPLOSION_NOT_ALLOWED/);
  assert.throws(() => resumeElection(first, first.revision, first.game), /NEXT_NIGHT_REQUIRED/);
  const restored = JSON.parse(JSON.stringify(first));
  const secondDay = resumeElection(restored, restored.revision, settleNight({ ...first.game, night: 2 }, 6, null));
  assert.equal(secondDay.stage, 'withdrawal');
  assert.deepEqual(secondDay.registered, [1, 2, 9, 10]);
  assert.deepEqual(secondDay.candidates, [2, 9, 10]);
  const second = explodeElection(secondDay, secondDay.revision, 2);
  assert.equal(second.stage, 'finished');
  assert.equal(second.game.sheriff, null);
  assert.deepEqual(second.deaths, [2, 6]);
  assert.equal(second.events.filter(e => e.type === 'sheriff-result').length, 1);
});

test('WW-63–64: after first explosion, normal election may succeed or PK may be interrupted', () => {
  const first = explodeElection(beginElection(game(), [9, 10]), 0, 1);
  const resumed = resumeElection(first, first.revision, { ...first.game, night: 2 });
  const voting = keepAll(resumed);
  const elected = voteAll(voting, Array(9).fill(9));
  assert.equal(elected.game.sheriff, 9);
  const pk = voteAll(voting, [9, 9, 9, 9, 10, 10, 10, 10, null]);
  assert.equal(pk.stage, 'pk');
  assert.equal(explodeElection(pk, pk.revision, 2).stage, 'finished');
  assert.equal(explodeElection(voting, voting.revision, 2).game.sheriff, null);
});

test('WW-68–71: forbidden phases, wrong role, old revision and long speech fail without mutations; room modes differ', () => {
  const initial = beginElection(game(), [9, 10]);
  const snapshot = structuredClone(initial);
  assert.throws(() => explodeElection(initial, 0, 5), /NOT_WOLF/);
  assert.throws(() => advanceElection(initial, 0, 10, { kind: 'speak', text: '插队' }), /INELIGIBLE_ELECTION_ACTOR/);
  assert.throws(() => advanceElection(initial, 0, 9, { kind: 'speak', text: '字'.repeat(301) }), /INVALID_SPEECH/);
  const first = explodeElection(initial, 0, 1);
  assert.throws(() => advanceElection(first, 0, 9, { kind: 'speak', text: '过期' }), /REVISION_CONFLICT/);
  assert.equal(explodeElection(beginElection(game(), [9, 10], 'single'), 0, 1).stage, 'finished');
  const none = beginElection(game(), [], 'none');
  assert.equal(none.stage, 'finished');
  assert.throws(() => explodeElection(none, 0, 1), /EXPLOSION_NOT_ALLOWED/);
  assert.throws(() => beginElection(kill(game(), 9, 'knife'), [9]), /INELIGIBLE_CANDIDATE/);
  assert.throws(() => beginElection(game(), [9, 9]), /DUPLICATE_CANDIDATE/);
  assert.deepEqual(initial, snapshot);
});

test('WW-60,75–76: elected night-dead sheriff completes hunter and badge chain before continuation', () => {
  const elected = beginElection(settleNight(game(), 11, null), [11]);
  assert.equal(elected.game.sheriff, 11);
  const original = beginSettlement(elected.game, elected.deaths);
  assert.deepEqual(original.queue.map(a => a.kind), ['last-words', 'shot', 'badge-transfer']);
  const words = advanceSettlement(original, 0, 11, { kind: 'last-words', text: '警徽给9号' });
  const shot = advanceSettlement(words, 1, 11, { kind: 'shot', target: null });
  assert.equal(shot.complete, false);
  const transferred = advanceSettlement(shot, 2, 11, { kind: 'badge-transfer', target: 9 });
  assert.equal(transferred.complete, true);
  assert.equal(transferred.game.sheriff, 9);

  const first = explodeElection(beginElection(settleNight(game(), 5, null), [9, 10]), 0, 1);
  const deaths = beginSettlement(first.game, first.deaths);
  assert.deepEqual(deaths.queue, [{ kind: 'last-words', seat: 5 }]);
  const done = advanceSettlement(deaths, 0, 5, { kind: 'last-words', text: '首夜遗言' });
  const resumed = resumeElection(first, first.revision, { ...done.game, night: 2 });
  assert.equal(resumed.stage, 'withdrawal');
});

test('WW-33,57,68: duplicate ballot, invalid target and first-day voting explosion reject atomically', () => {
  const voting = keepAll(speakAll(beginElection(game(), [9, 10])));
  const snapshot = structuredClone(voting);
  assert.throws(() => explodeElection(voting, voting.revision, 1), /EXPLOSION_NOT_ALLOWED/);
  assert.throws(() => advanceElection(voting, voting.revision, 1, { kind: 'vote', target: 5 }), /INVALID_VOTE_TARGET/);
  const next = advanceElection(voting, voting.revision, 1, { kind: 'vote', target: 9 });
  assert.throws(() => advanceElection(next, voting.revision, 1, { kind: 'vote', target: 10 }), /REVISION_CONFLICT/);
  assert.throws(() => advanceElection(next, next.revision, 1, { kind: 'vote', target: 10 }), /INELIGIBLE_ELECTION_ACTOR/);
  assert.equal(next.events.filter(e => e.type === 'sheriff-ballot').length, 1);
  assert.deepEqual(voting, snapshot);
});
