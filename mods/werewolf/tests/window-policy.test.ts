import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptDecision, createRoom, occupySeat, settleDecisionWindow } from '@game-ai/turn-based';
import { werewolfDefinition } from '../src/definition.ts';
import { beginElection, advanceElection } from '../src/election.ts';
import { createMatch, matchPhase, type Match } from '../src/match.ts';
import type { Json } from '@game-ai/core';

test('night deadlines are fixed and elected sheriff alone gets 120+30 seconds of day speech', () => {
  const definition = werewolfDefinition({ seed: 17, sheriff: 'double' });
  let room = createRoom('timer-room', 'timer-run', definition);
  for (let seat = 1; seat <= 12; seat++) room = occupySeat(room, {
    seat, name: `${seat}`, modelProfile: 'script', scopeId: `scope-${seat}`, interruptScopeId: `interrupt-${seat}`,
  }, definition);
  assert.equal(definition.windowMs!(room), 60_000);
  assert.equal(definition.fixedWindow!(room), true);
  assert.equal(definition.actionWindowMs!(room), 60_000);
  room.phase = { ...room.phase!, key: 'witch', mode: 'sequential', actors: [1] };
  assert.equal(definition.windowMs!(room), 30_000);
  assert.equal(definition.fixedWindow!(room), true);
  room.phase = { ...room.phase!, key: 'election-speech' };
  assert.equal(definition.windowMs!(room), 120_000);
  assert.equal(definition.fixedWindow!(room), true);
  room.phase = { ...room.phase!, key: 'speech' };
  assert.equal(definition.windowMs!(room), 120_000);
  (room.state as any).game.sheriff = room.phase.actors[0];
  assert.equal(definition.windowMs!(room), 150_000);
  room.phase = { ...room.phase!, key: 'last-words' };
  assert.equal(definition.windowMs!(room), 90_000);
  room.phase = { ...room.phase!, key: 'direction' };
  assert.equal(definition.windowMs!(room), 20_000);
  room.phase = { ...room.phase!, key: 'vote' };
  assert.equal(definition.windowMs!(room), 30_000);
  (room.state as any).game.players.find((player: { role: string }) => player.role === 'witch').alive = false;
  room.phase = { ...room.phase!, key: 'wolves' };
  assert.equal(definition.windowMs!(room), 90_000);
  assert.equal(definition.actionWindowMs!(room), 60_000);
});

test('Robot speech no longer requests early completion, regardless of speech phase', () => {
  const definition = werewolfDefinition({ seed: 17, sheriff: 'double' });
  let room = createRoom('skip-room', 'skip-run', definition);
  for (let seat = 1; seat <= 12; seat++) room = occupySeat(room, {
    seat, name: `${seat}`, modelProfile: 'script', userId: `robot-${seat}`, controllerKind: 'robot',
    scopeId: `scope-${seat}`, interruptScopeId: `interrupt-${seat}`,
  }, definition);
  for (const key of ['speech', 'election-speech', 'pk', 'election-pk']) {
    room.phase = { ...room.phase!, key, mode: 'sequential', actors: [1] };
    assert.equal(definition.completionDelayMs?.(room) ?? null, null);
  }
  for (const key of ['last-words', 'shot', 'vote', 'wolves', 'witch']) {
    room.phase = { ...room.phase!, key, mode: 'sequential', actors: [1] };
    assert.equal(definition.completionDelayMs?.(room) ?? null, null);
  }
  room.phase = { ...room.phase!, key: 'speech', actors: [1] };
  room.seats[0].controllerKind = 'human';
  assert.equal(definition.completionDelayMs?.(room) ?? null, null);
});

test('WW-77,78,83: one sealed ten-second window hides withdrawals until final settlement', () => {
  const definition = werewolfDefinition({ seed: 17, sheriff: 'double' });
  let room = createRoom('withdraw-room', 'withdraw-run', definition);
  for (let seat = 1; seat <= 12; seat++) room = occupySeat(room, {
    seat, name: `${seat}`, modelProfile: 'script', scopeId: `scope-${seat}`, interruptScopeId: `interrupt-${seat}`,
  }, definition);
  const match = createMatch({ seed: 17, sheriff: 'double' });
  let election = beginElection(match.game, [1, 2, 3]);
  while (election.stage === 'speech') election = advanceElection(election, election.revision, election.pending[0],
    { kind: 'speech', text: '竞选发言' });
  match.stage = 'election';
  match.election = election;
  match.game = election.game;
  room.state = match as unknown as Json;
  room.phase = matchPhase(match)!;
  room.phaseDeadlineAt = 10_000;
  room.phaseActionDeadlineAt = 10_000;
  assert.equal(room.phase.key, 'election-withdrawal');
  assert.equal(room.phase.label, '警长退水');
  assert.equal(room.phase.mode, 'sealed');
  assert.deepEqual(room.phase.actors, [1, 2, 3]);
  assert.equal(definition.windowMs!(room), 10_000);
  room = acceptDecision(room, room.phaseInstance, 3, { kind: 'withdraw', withdraw: true }, definition);
  room = acceptDecision(room, room.phaseInstance, 1, { kind: 'withdraw', withdraw: true }, definition);
  room = acceptDecision(room, room.phaseInstance, 2, { kind: 'withdraw', withdraw: false }, definition);
  assert.equal(room.phase?.key, 'election-withdrawal');
  assert.equal(room.events.some(event => event.type === 'sheriff-withdrawal'), false);
  const resolved = settleDecisionWindow(room, definition);
  assert.deepEqual(resolved.events.filter(event => event.type === 'sheriff-withdrawal').map(event =>
    (event.data as { seat: number }).seat), [1, 3]);
  assert.equal((resolved.state as unknown as Match).game.sheriff, 2);
});
