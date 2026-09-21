import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, resolveWolfKnife, useMedicine, inspectSeat, exile,
  kill, canShoot, hasLastWords, tallyVotes, verdict, speakingOrder,
  settleNight, announceDeaths, electionEligible, transferBadge,
  type GameState,
} from '../src/rules.ts';

function game(): GameState {
  const state = createGame(42);
  const roles = ['wolf', 'wolf', 'wolf', 'wolf', 'villager', 'villager',
    'villager', 'villager', 'seer', 'witch', 'hunter', 'idiot'] as const;
  state.players.forEach((player, index) => { player.role = roles[index]; });
  return state;
}

test('WW-03: seeded identity allocation is reproducible, varied and exactly 4/4/1/1/1/1', () => {
  assert.deepEqual(createGame(42), createGame(42));
  const layouts = new Set<string>();
  for (let seed = 0; seed < 100; seed++) {
    const state = createGame(seed);
    const counts: Record<string, number> = {};
    for (const player of state.players) counts[player.role] = (counts[player.role] ?? 0) + 1;
    assert.deepEqual(counts, { wolf: 4, villager: 4, seer: 1, witch: 1, hunter: 1, idiot: 1 });
    layouts.add(state.players.map(player => player.role).join(','));
  }
  assert.ok(layouts.size > 90);
});

test('WW-11–13: wolves require one live-wolf ballot each; majority, self knife, empty knife and seeded ties', () => {
  const state = game();
  const choose = (targets: (number | null)[]) => targets.map((target, index) => ({ seat: index + 1, target }));
  assert.equal(resolveWolfKnife(state, choose([1, 1, 1, 5])).target, 1);
  assert.equal(resolveWolfKnife(state, choose([null, null, null, 5])).target, 5);
  const tied = choose([5, 5, 6, 6]);
  assert.deepEqual(resolveWolfKnife(state, tied), resolveWolfKnife(state, [...tied].reverse()));
  assert.ok([5, 6].includes(resolveWolfKnife(state, tied).target!));
  assert.throws(() => resolveWolfKnife(state, choose([5])));
  assert.throws(() => resolveWolfKnife(state, [{ seat: 1, target: 5 }, { seat: 1, target: 5 }]));
  assert.throws(() => resolveWolfKnife(state, choose([99, 5, 5, 5])));
});

test('WW-17–21: one medicine per night, no self save, one bottle each and no input mutation', () => {
  const state = game();
  const original = structuredClone(state);
  assert.throws(() => useMedicine(state, 10, 10, { kind: 'save' }));
  assert.throws(() => useMedicine(state, 10, null, { kind: 'save' }));
  assert.throws(() => useMedicine(state, 10, 5, { kind: 'save', target: 6 } as never));
  const saved = useMedicine(state, 10, 5, { kind: 'save' });
  assert.equal(saved.knife, null);
  assert.equal(saved.state.antidote, false);
  assert.throws(() => useMedicine(saved.state, 10, 5, { kind: 'poison', target: 6 }));
  const nextNight = { ...saved.state, night: 2 };
  assert.throws(() => useMedicine(nextNight, 10, 5, { kind: 'save' }));
  const poisoned = useMedicine(nextNight, 10, 5, { kind: 'poison', target: 6 });
  assert.equal(poisoned.poison, 6);
  assert.equal(poisoned.state.poison, false);
  assert.throws(() => useMedicine({ ...poisoned.state, night: 3 }, 10, 5, { kind: 'poison', target: 7 }));
  assert.throws(() => useMedicine(kill(state, 10, 'knife'), 10, 5, { kind: 'save' }));
  assert.deepEqual(state, original);
});

test('WW-22–24: seer sees only alignment; repeat in same or consecutive night rejected', () => {
  const state = game();
  const checked = inspectSeat(state, 9, 1);
  assert.deepEqual(checked.state.inspections, [{ night: 1, target: 1, alignment: 'wolf' }]);
  assert.throws(() => inspectSeat(checked.state, 9, 5));
  assert.throws(() => inspectSeat({ ...checked.state, night: 2 }, 9, 1));
  const second = inspectSeat({ ...checked.state, night: 2 }, 9, 10);
  assert.equal(second.alignment, 'good');
  assert.equal(inspectSeat({ ...second.state, night: 3 }, 9, 1).alignment, 'wolf');
  assert.throws(() => inspectSeat(state, 5, 1));
  assert.throws(() => inspectSeat(kill(state, 1, 'knife'), 9, 1));
});

test('WW-04–07,34–35: ties, PK target/voter restrictions, abstention, missing ballot and sheriff weight', () => {
  const state = game();
  const votes = [{ seat: 1, target: 5 }, { seat: 2, target: 6 }, { seat: 3, target: null }];
  const result = tallyVotes(state, votes, { kind: 'exile', voters: [1, 2, 3, 4], candidates: [5, 6] });
  assert.deepEqual(result.tied, [5, 6]);
  assert.deepEqual(result.ballots.map(v => v.kind), ['vote', 'vote', 'abstain', 'missing']);
  assert.equal(tallyVotes({ ...state, sheriff: 1 }, votes, {
    kind: 'exile', voters: [1, 2, 3, 4], candidates: [5, 6],
  }).winner, 5);
  assert.equal(tallyVotes({ ...state, sheriff: 1 }, votes, {
    kind: 'sheriff', voters: [1, 2, 3, 4], candidates: [5, 6],
  }).winner, null);
  assert.deepEqual(tallyVotes(state, votes, {
    kind: 'exile', voters: [1, 2, 3, 4], candidates: [5, 6], runoff: true,
  }).tied, []);
  assert.throws(() => tallyVotes(state, [{ seat: 1, target: 7 }], {
    kind: 'exile', voters: [1, 2], candidates: [5, 6], runoff: true,
  }));
  assert.throws(() => tallyVotes(state, [{ seat: 5, target: 6 }], {
    kind: 'exile', voters: [1, 2, 5], candidates: [5, 6], runoff: true,
  }));
  assert.throws(() => tallyVotes(state, [votes[0], votes[0]], {
    kind: 'exile', voters: [1, 2], candidates: [5, 6],
  }));
  const empty = tallyVotes(state, [], { kind: 'exile', voters: [1, 2], candidates: [5, 6] });
  assert.equal(empty.winner, null);
  assert.deepEqual(empty.tied, []);
  assert.deepEqual(empty.totals, [{ seat: 5, votes: 0 }, { seat: 6, votes: 0 }]);
});

test('WW-08–10,59: idiot exile reveals without death, loses vote/eligibility but remains a living god', () => {
  const state = game();
  const revealed = exile(state, 12);
  assert.equal(revealed.players[11].alive, true);
  assert.equal(revealed.players[11].revealed, true);
  assert.equal(revealed.players[11].death, null);
  assert.throws(() => exile(revealed, 12));
  assert.throws(() => tallyVotes(revealed, [{ seat: 12, target: 5 }], {
    kind: 'exile', voters: [12], candidates: [5],
  }));
  assert.throws(() => tallyVotes(revealed, [{ seat: 5, target: 12 }], {
    kind: 'exile', voters: [5], candidates: [12],
  }));
  const godsDead = [9, 10, 11].reduce((s, seat) => kill(s, seat, 'poison'), revealed);
  assert.equal(verdict(godsDead), null);
  assert.equal(verdict(kill(godsDead, 12, 'knife'))?.winner, 'wolf');
  assert.equal(state.players[11].revealed, false);
});

test('WW-25–30: hunter eligibility and last words depend on actual death cause/night', () => {
  assert.equal(canShoot(kill(game(), 11, 'knife'), 11), true);
  assert.equal(canShoot(exile(game(), 11), 11), true);
  assert.equal(canShoot(kill(game(), 11, 'poison'), 11), false);
  assert.equal(canShoot(game(), 11), false);
  assert.equal(hasLastWords(kill(game(), 5, 'knife'), 5), true);
  assert.equal(hasLastWords(kill({ ...game(), night: 2 }, 5, 'knife'), 5), false);
  assert.equal(hasLastWords(exile({ ...game(), night: 2 }, 5), 5), true);
  assert.equal(hasLastWords(kill(game(), 1, 'explode'), 1), false);
  assert.equal(hasLastWords(exile(game(), 12), 12), false);
});

test('WW-40–41: eliminate wolves or either good side; pending hunter shot defers victory', () => {
  let state = game();
  for (const seat of [1, 2, 3, 4]) state = kill(state, seat, 'poison');
  assert.deepEqual(verdict(state), { winner: 'good', reason: 'wolves-eliminated' });
  state = game();
  for (const seat of [5, 6, 7, 8]) state = kill(state, seat, 'knife');
  assert.deepEqual(verdict(state), { winner: 'wolf', reason: 'villagers-eliminated' });
  assert.equal(verdict(state, ['last-words']), null);
  assert.equal(verdict(state, ['badge-transfer']), null);
});

test('WW-52–53: speaking order wraps, skips dead seats and uses explicit reproducible random state', () => {
  const state = kill(game(), 5, 'knife');
  assert.deepEqual(speakingOrder(state, [5], 'counterclockwise').seats, [4, 3, 2, 1, 12, 11, 10, 9, 8, 7, 6]);
  assert.deepEqual(speakingOrder(state, [5], 'clockwise').seats, [6, 7, 8, 9, 10, 11, 12, 1, 2, 3, 4]);
  assert.deepEqual(speakingOrder(state, []), speakingOrder(state, []));
  assert.equal(new Set(speakingOrder(state, []).seats).size, 11);
});


test('WW-12–13: empty choices never beat real targets; all empty leaves poison deaths intact', () => {
  const state = game();
  const ballots = [null, null, 5, 6].map((target, index) => ({ seat: index + 1, target }));
  assert.ok([5, 6].includes(resolveWolfKnife(state, ballots).target!));
  assert.equal(resolveWolfKnife(state, ballots.map(b => ({ ...b, target: null }))).target, null);
  const night = settleNight(state, null, 5);
  assert.equal(night.players[4].alive, false);
  assert.equal(night.players[4].death?.cause, 'poison');
});

test('WW-26,72,76: knife/poison precedence, delayed announcement, dead candidate elected then transfers badge', () => {
  const state = game();
  const night = settleNight(state, 11, 11);
  assert.equal(canShoot(night, 11), false);
  assert.equal(electionEligible(night, 11), true);
  const election = tallyVotes(night, [], { kind: 'sheriff', candidates: [11], voters: [] });
  assert.equal(election.winner, 11);
  const announced = announceDeaths({ ...night, sheriff: election.winner });
  assert.equal(electionEligible(announced, 11), false);
  assert.equal(transferBadge(announced, 11, 5).sheriff, 5);
  assert.equal(electionEligible(settleNight(state, 5, null), 5), true);
  assert.equal(electionEligible(settleNight(state, null, 6), 6), true);
  assert.equal(state.players[10].alive, true);
});

test('WW-65,67: single candidate wins without votes; no electable result loses badge; sheriff explosion cannot transfer', () => {
  const state = game();
  assert.equal(tallyVotes(state, [], { kind: 'sheriff', candidates: [5], voters: [] }).winner, 5);
  assert.equal(tallyVotes(state, [], { kind: 'sheriff', candidates: [5, 6], voters: [] }).winner, null);
  assert.equal(tallyVotes(state, [], { kind: 'sheriff', candidates: [], voters: [1] }).winner, null);
  const exploded = kill({ ...state, sheriff: 1 }, 1, 'explode');
  assert.equal(exploded.sheriff, null);
  assert.throws(() => transferBadge(exploded, 1, 5));
});

test('WW-74–75: simultaneous wins draw for either good side, independent of death order; chains defer result', () => {
  for (const side of [[5, 6, 7, 8], [9, 10, 11, 12]]) {
    const deaths = [1, 2, 3, 4, ...side];
    for (const order of [deaths, [...deaths].reverse()]) {
      const state = order.reduce((s, seat) => kill(s, seat, 'poison'), game());
      assert.deepEqual(verdict(state), { winner: 'draw', reason: 'both-conditions' });
      for (const chain of ['last-words', 'shot', 'badge-transfer'] as const) {
        assert.equal(verdict(state, [chain]), null);
      }
    }
  }
});

test('WW-52: multi-death anchor is randomized over dead seats, stable across input ordering and reload', () => {
  let state = kill(kill(game(), 5, 'knife'), 8, 'poison');
  const anchors = new Set<number | null>();
  for (let seed = 0; seed < 30; seed++) {
    state = { ...state, random: seed };
    const order = speakingOrder(state, [5, 8]);
    assert.deepEqual(order, speakingOrder(JSON.parse(JSON.stringify(state)), [8, 5]));
    anchors.add(order.anchor);
    assert.equal(order.seats.length, 10);
    assert.equal(order.seats[0], order.anchor === 5 ? 4 : 7);
  }
  assert.deepEqual([...anchors].sort(), [5, 8]);
});


test('WW-70: unannounced poisoned wolf may explode; poison stays spent and other night deaths remain', () => {
  const used = useMedicine(game(), 10, 5, { kind: 'poison', target: 1 });
  const night = settleNight(used.state, used.knife, used.poison);
  const exploded = kill(night, 1, 'explode');
  assert.equal(exploded.players[0].death?.cause, 'explode');
  assert.equal(exploded.poison, false);
  assert.equal(exploded.players[4].death?.cause, 'knife');
  assert.equal(hasLastWords(exploded, 1), false);
  assert.throws(() => kill(announceDeaths(night), 1, 'explode'));
  assert.throws(() => kill(exploded, 1, 'explode'));
  assert.equal(night.players[0].death?.cause, 'poison');
});
