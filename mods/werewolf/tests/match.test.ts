import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, occupySeat, acceptDecision, eligibleActors, spectatorView } from '@game-ai/turn-based';
import type { Json } from '@game-ai/core';
import { createMatch, decideMatch, explodeMatch, matchPhase, type Match } from '../src/match.ts';
import { werewolfDefinition } from '../src/definition.ts';

/** Deliberately omniscient scripted choices, not an AI/model-quality test. */
function choice(state: Match, seat: number): Json {
  const living = state.game.players.filter(p => p.alive);
  switch (state.stage) {
    case 'wolves': return { kind: 'knife', target: living.find(p => p.role === 'villager')!.seat };
    case 'witch': return { kind: 'pass' };
    case 'seer': return { kind: 'inspect', target: living.find(p => p.seat !== state.game.inspections.at(-1)?.target)!.seat };
    case 'nominations': return { kind: 'nominate', run: state.game.players.find(p => p.seat === seat)!.role === 'seer' };
    case 'direction': return { kind: 'direction', direction: 'clockwise' };
    case 'speech': case 'pk': return { kind: 'speak', text: '公开发言' };
    case 'vote': return { kind: 'vote', target: null };
    case 'election': {
      const election = state.election!;
      if (election.stage === 'speech' || election.stage === 'pk') return { kind: 'speak', text: '竞选' };
      if (election.stage === 'withdrawal') return { kind: 'withdraw', withdraw: false };
      return { kind: 'vote', target: election.candidates[0] };
    }
    case 'settlement': {
      const action = state.settlement!.queue[0];
      return action.kind === 'last-words' ? { kind: action.kind, text: '遗言' } : { kind: action.kind, target: null };
    }
    default: throw new Error(`Unexpected stage ${state.stage}`);
  }
}
function until(source: Match, stage: Match['stage']): Match {
  let state = source;
  for (let i = 0; i < 300 && state.stage !== stage; i++) {
    const actor = matchPhase(state)!.actors[0];
    state = decideMatch(state, state.revision, actor, choice(state, actor));
  }
  assert.equal(state.stage, stage);
  return state;
}

test('WW-01–03,42,46: actual public RoomDefinition engine runs a full seeded game and reveals only at finish', () => {
  const definition = werewolfDefinition({ seed: 42, sheriff: 'double' });
  let room = createRoom('whole-game', 'scripted-run', definition);
  for (let seat = 1; seat <= 12; seat++) {
    room = occupySeat(room, { seat, name: `AI ${seat}`, modelProfile: 'scripted', scopeId: `scope-${seat}`, interruptScopeId: `interrupt-${seat}` }, definition);
    assert.equal(room.status, seat < 12 ? 'waiting' : 'running');
  }
  let steps = 0;
  while (room.status === 'running' && steps++ < 500) {
    assert.equal('replay' in spectatorView(room, definition), false);
    const actor = eligibleActors(room)[0];
    room = acceptDecision(room, room.phaseInstance, actor, choice(room.state as unknown as Match, actor), definition);
  }
  assert.equal(room.status, 'finished');
  const view = spectatorView(room, definition);
  assert.deepEqual(view.result, { winner: 'wolf', reason: 'villagers-eliminated' });
  assert.ok(view.replay);
  assert.ok(view.events.some(e => e.type === 'wolf-choices'));
  assert.ok(view.events.some(e => e.type === 'exile-votes'));
});

test('WW-42,50: pure match JSON reload after each decision yields identical events and result', () => {
  let direct = createMatch({ seed: 7, sheriff: 'none' });
  let restored = structuredClone(direct);
  for (let i = 0; direct.stage !== 'finished' && i < 500; i++) {
    const actor = matchPhase(direct)!.actors[0];
    const action = choice(direct, actor);
    direct = decideMatch(direct, direct.revision, actor, action);
    restored = decideMatch(JSON.parse(JSON.stringify(restored)), restored.revision, actor, action);
    assert.deepEqual(restored, direct);
  }
  assert.equal(direct.stage, 'finished');
});

test('WW-14–15,54–55,68: day explosion interrupts another speaker; old response and night explosion rejected', () => {
  const start = createMatch({ seed: 42, sheriff: 'none' });
  const wolf = start.game.players.find(p => p.role === 'wolf')!.seat;
  assert.throws(() => explodeMatch(start, start.revision, wolf), /EXPLOSION_NOT_ALLOWED/);
  const day = until(start, 'speech');
  const speaker = matchPhase(day)!.actors[0];
  const exploding = day.game.players.find(p => p.role === 'wolf' && p.seat !== speaker)!.seat;
  const night = explodeMatch(day, day.revision, exploding);
  assert.equal(night.stage, 'wolves');
  assert.equal(night.game.night, 2);
  assert.equal(night.game.players.find(p => p.seat === exploding)!.alive, false);
  assert.throws(() => decideMatch(night, day.revision, speaker, { kind: 'speak', text: '迟到' }), /REVISION_CONFLICT/);
  assert.equal(day.game.night, 1);
});

test('WW-04–06: exile tie triggers only tied speakers; second tie advances night', () => {
  let state = until(createMatch({ seed: 42, sheriff: 'none' }), 'vote');
  const targets = state.game.players.filter(p => p.alive && !p.revealed).slice(0, 2).map(p => p.seat);
  let index = 0;
  while (state.stage === 'vote') {
    const actors = matchPhase(state)!.actors;
    const target = actors.length === 1 && index % 2 === 0 ? null : targets[index++ % 2];
    state = decideMatch(state, state.revision, actors[0], { kind: 'vote', target });
  }
  assert.equal(state.stage, 'pk');
  const heard: number[] = [];
  while (state.stage === 'pk') {
    const actor = matchPhase(state)!.actors[0];
    heard.push(actor);
    state = decideMatch(state, state.revision, actor, { kind: 'speak', text: 'PK' });
  }
  assert.deepEqual(heard, targets);
  assert.ok(matchPhase(state)!.actors.every(seat => !targets.includes(seat)));
  index = 0;
  while (state.stage === 'vote') {
    const actors = matchPhase(state)!.actors;
    const target = actors.length === 1 && index % 2 === 0 ? null : targets[index++ % 2];
    state = decideMatch(state, state.revision, actors[0], { kind: 'vote', target });
  }
  assert.equal(state.stage, 'wolves');
  assert.equal(state.game.night, 2);
});

test('WW-08–10: idiot reveal survives exile, next day schema excludes its vote and candidacy', () => {
  let state = until(createMatch({ seed: 42, sheriff: 'none' }), 'vote');
  const idiot = state.game.players.find(p => p.role === 'idiot')!.seat;
  while (state.stage === 'vote') {
    state = decideMatch(state, state.revision, matchPhase(state)!.actors[0], { kind: 'vote', target: idiot });
  }
  assert.equal(state.stage, 'wolves');
  assert.equal(state.game.players.find(p => p.seat === idiot)!.alive, true);
  assert.equal(state.game.players.find(p => p.seat === idiot)!.revealed, true);
  state = until(state, 'vote');
  const phase = matchPhase(state)!;
  assert.equal(phase.actors.includes(idiot), false);
  assert.throws(() => decideMatch(state, state.revision, phase.actors[0], { kind: 'vote', target: idiot }), /INVALID_MATCH_ACTION/);
  assert.equal(state.events.filter(e => e.type === 'last-words' && (e.data as { seat: number }).seat === idiot).length, 0);
});

test('WW-60–62: whole match first explosion resolves deaths then resumes withdrawal across night; second ends election', () => {
  let state = until(createMatch({ seed: 42, sheriff: 'double' }), 'nominations');
  while (state.stage === 'nominations') {
    const seat = matchPhase(state)!.actors[0];
    const role = state.game.players.find(p => p.seat === seat)!.role;
    state = decideMatch(state, state.revision, seat, { kind: 'nominate', run: role === 'seer' || role === 'witch' });
  }
  assert.equal(state.stage, 'election');
  const nominations = [...state.election!.registered];
  const wolves = state.game.players.filter(p => p.role === 'wolf').map(p => p.seat);
  const exploded = explodeMatch(state, state.revision, wolves[0]);
  assert.equal(exploded.stage, 'settlement');
  assert.throws(() => explodeMatch(exploded, exploded.revision, wolves[1]), /EXPLOSION_NOT_ALLOWED/);
  state = until(exploded, 'wolves');
  assert.equal(state.game.night, 2);
  state = until(state, 'election');
  assert.equal(state.election!.stage, 'withdrawal');
  assert.deepEqual(state.election!.registered, nominations);
  state = explodeMatch(state, state.revision, wolves[1]);
  assert.equal(state.stage, 'wolves');
  assert.equal(state.game.night, 3);
  assert.equal(state.election!.stage, 'finished');
  assert.equal(state.game.sheriff, null);
  assert.equal(state.events.filter(e => e.type === 'sheriff-result').length, 1);
});

test('WW-40,75: empty nights and successive wolf exiles end in good victory only after final last words', () => {
  let state = createMatch({ seed: 42, sheriff: 'none' });
  let finalWords = false;
  for (let i = 0; state.stage !== 'finished' && i < 500; i++) {
    const actor = matchPhase(state)!.actors[0];
    let action = choice(state, actor);
    if (state.stage === 'wolves') action = { kind: 'knife', target: null };
    if (state.stage === 'vote') action = { kind: 'vote', target: state.game.players.find(p => p.alive && p.role === 'wolf')!.seat };
    if (!state.game.players.some(p => p.alive && p.role === 'wolf')) {
      assert.equal(state.stage, 'settlement');
      assert.equal(state.result, null);
      finalWords = true;
    }
    state = decideMatch(state, state.revision, actor, action);
  }
  assert.equal(finalWords, true);
  assert.equal(state.stage, 'finished');
  assert.deepEqual(state.result, { winner: 'good', reason: 'wolves-eliminated' });
  assert.equal(state.game.night, 4);
  assert.equal(state.events.at(-2)!.type, 'last-words');
  assert.equal(state.events.at(-1)!.type, 'game-result');
});
