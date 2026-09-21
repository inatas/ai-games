import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Json } from '@game-ai/core';
import { createRoom, occupySeat, acceptInterrupt, spectatorView } from '@game-ai/turn-based';
import { createMatch, matchPhase, type Match } from '../src/match.ts';
import { beginElection } from '../src/election.ts';
import { settleNight } from '../src/rules.ts';
import { werewolfDefinition } from '../src/definition.ts';

const definition = werewolfDefinition({ seed: 42, sheriff: 'double' });
function wrap(state: Match) {
  let room = createRoom('werewolf-test', 'run', definition);
  for (let seat = 1; seat <= 12; seat++) room = occupySeat(room, {
    seat, name: `AI ${seat}`, modelProfile: 'test', scopeId: `normal-${seat}`, interruptScopeId: `interrupt-${seat}`,
  }, definition);
  room.state = state as unknown as Json;
  room.phase = matchPhase(state);
  return room;
}
function daytime() {
  const state = createMatch({ seed: 42, sheriff: 'double' });
  state.stage = 'speech'; state.pending = state.game.players.map(p => p.seat);
  return state;
}

test('WW-77/78: interrupt eligibility follows game stages; sheriff explosion loses badge', () => {
  const state = daytime(); const wolf = state.game.players.find(p => p.role === 'wolf')!.seat;
  state.game.sheriff = wolf;
  const room = wrap(state);
  assert.ok(room.phase!.interrupt?.actors.includes(wolf));
  const next = acceptInterrupt(room, room.phaseInstance, wolf, { kind: 'explode' }, definition);
  const match = next.state as unknown as Match;
  assert.equal(match.game.sheriff, null);
  assert.equal(match.stage, 'wolves');
  assert.equal(match.game.night, 2);
  assert.equal(match.game.players.find(p => p.seat === wolf)!.death!.cause, 'explode');
  assert.equal(next.phase!.interrupt, undefined);
  assert.throws(() => acceptInterrupt(room, 1, wolf, { kind: 'explode', seat: 1 }, definition), /INVALID_DECISION/);
  assert.doesNotMatch(JSON.stringify(spectatorView(room, definition)), /interruptScope|antidote|inspections/);
});

test('WW-78: unannounced poisoned wolf may interrupt election; poison remains spent and other deaths settle', () => {
  const state = daytime();
  const wolf = state.game.players.find(p => p.role === 'wolf')!.seat;
  const victim = state.game.players.find(p => p.role === 'villager')!.seat;
  state.game.poison = false;
  state.game = settleNight(state.game, victim, wolf);
  state.stage = 'election'; state.election = beginElection(state.game, [wolf, victim]);
  const room = wrap(state);
  assert.ok(room.phase!.interrupt?.actors.includes(wolf));
  const next = acceptInterrupt(room, 1, wolf, { kind: 'explode' }, definition);
  const match = next.state as unknown as Match;
  assert.equal(match.game.poison, false);
  assert.equal(match.game.players.find(p => p.seat === wolf)!.death!.cause, 'explode');
  assert.equal(match.game.players.find(p => p.seat === victim)!.death!.announced, true);
  assert.equal(match.settlement!.queue.some(item => item.seat === wolf && item.kind === 'last-words'), false);
  assert.equal(match.election!.stage, 'suspended');
  assert.equal(match.stage, 'settlement');
});

test('WW-78/80: pass leaves game unchanged; nonwolves, night and first election ballots cannot interrupt', () => {
  const state = daytime(); const wolf = state.game.players.find(p => p.role === 'wolf')!.seat;
  const good = state.game.players.find(p => p.role !== 'wolf')!.seat;
  const room = wrap(state);
  assert.deepEqual(acceptInterrupt(room, 1, wolf, { kind: 'pass' }, definition), room);
  assert.throws(() => acceptInterrupt(room, 1, good, { kind: 'explode' }, definition), /ACTOR_NOT_ELIGIBLE/);
  assert.equal(matchPhase(createMatch({ seed: 42, sheriff: 'double' }))!.interrupt, undefined);
  state.stage = 'election'; state.election = beginElection(state.game, [wolf, good]);
  state.election.stage = 'voting'; state.election.pending = [good];
  assert.equal(matchPhase(state)!.interrupt, undefined);
  state.election.firstExplosionNight = 1; state.game.night = 2; state.election.game = structuredClone(state.game);
  assert.ok(matchPhase(state)!.interrupt?.actors.includes(wolf));
});
