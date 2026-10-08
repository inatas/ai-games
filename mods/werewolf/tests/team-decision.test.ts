import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptDecision, createRoom, occupySeat, actorView, spectatorView } from '@game-ai/turn-based';
import { werewolfDefinition } from '../src/definition.ts';
import { prepareWerewolfDecision } from '../src/decision-input.ts';
import { decodeWerewolfDecision } from '../src/decision-adapter.ts';
import type { Match } from '../src/match.ts';
import { modelRoomSnapshot } from '../server/werewolf-model-snapshot.ts';

test('WW-TC02/04/06: actual room opens private team proposal, explicit target consent then fixed wait', () => {
  const definition = werewolfDefinition({ seed: 42, sheriff: 'double' });
  let room = createRoom('team-room', 'team-room', definition);
  for (let seat = 1; seat <= 12; seat++) room = occupySeat(room, { seat, name: `${seat}号`, modelProfile: 'model',
    controllerKind: 'robot', scopeId: `scope-${seat}`, interruptScopeId: `interrupt-${seat}` }, definition);
  assert.equal(room.phase?.key, 'wolf-team-proposal');
  const leader = room.phase!.actors[0]!;
  const input = prepareWerewolfDecision(room, leader, definition);
  assert.equal(input.intent, 'SPEECH');
  const state = room.state as unknown as Match & { wolfTeam: { participants: number[] } };
  const target = state.wolfTeam.participants.find(seat => seat !== leader)!;
  const action = decodeWerewolfDecision(input, { kind: 'proposal', value: { speech: '建议刀队友，先询问本人',
    team_proposal: { knifeTarget: target, assignments: [], conditions: '', selfKnifeConsent: false } } } as never)!;
  room = acceptDecision(room, room.phaseInstance, leader, action, definition, 'model');
  assert.equal(room.phase?.key, 'wolf-team-self-knife-consent');
  assert.deepEqual(room.phase!.actors, [target]);
  const consent = prepareWerewolfDecision(room, target, definition);
  const yes = consent.options.find(option => (option.value as { accepted?: boolean }).accepted === true)!;
  room = acceptDecision(room, room.phaseInstance, target,
    decodeWerewolfDecision(consent, { kind: 'proposal', value: { selected: yes.id } })!, definition, 'model');
  assert.equal(room.phase?.key, 'wolf-team-wait');
  assert.equal(definition.windowMs!(room), 45_000);
  assert.equal(definition.fixedWindow!(room), true);
  assert.match(JSON.stringify(actorView(room, leader, definition)), /建议刀队友/);
  const outsider = state.game.players.find(p => p.role !== 'wolf')!.seat;
  assert.doesNotMatch(JSON.stringify(actorView(room, outsider, definition)), /建议刀队友/);
  assert.doesNotMatch(JSON.stringify(spectatorView(room, definition)), /建议刀队友/);
  const finished = { ...room, status: 'finished' as const, phase: null };
  assert.doesNotMatch(JSON.stringify(spectatorView(finished, definition)), /建议刀队友|team-consent|wolf-team-plan/);
  assert.doesNotMatch(JSON.stringify(modelRoomSnapshot(finished, definition, [])), /建议刀队友|team-consent|wolf-team-plan/);
});
