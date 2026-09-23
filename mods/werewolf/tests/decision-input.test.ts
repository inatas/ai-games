import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptDecision, createRoom, eligibleActors, occupySeat } from '@game-ai/turn-based';
import { werewolfDefinition } from '../src/definition.ts';
import { prepareWerewolfDecision } from '../src/decision-input.ts';
import { decodeWerewolfDecision } from '../src/decision-adapter.ts';
import type { Match } from '../src/match.ts';

test('script and model seats receive the same six-part authorized SPEAK/SELECT contract', () => {
  const definition = werewolfDefinition({ seed: 42, sheriff: 'double' });
  let room = createRoom('test-room', 'test-run', definition);
  for (let seat = 1; seat <= 12; seat++) room = occupySeat(room, {
    seat, name: `${seat}号`, modelProfile: seat === 1 ? 'environment-default' : 'script-random',
    ...(seat === 1 ? { userId: 'robot-1', persona: '谨慎但敢于质疑。' } : {}),
    scopeId: `scope-${seat}`, interruptScopeId: `interrupt-${seat}`,
  }, definition);
  const one = prepareWerewolfDecision(room, 1, definition);
  const two = prepareWerewolfDecision(room, 2, definition);
  assert.equal(one.intent, 'SELECT');
  assert.equal(two.intent, 'SELECT');
  assert.deepEqual(Object.keys(one.context).sort(), [
    'current_action', 'game_state', 'private_information', 'public_history', 'rules', 'self',
  ]);
  assert.equal(one.context.self.seat, 1);
  assert.equal(one.context.self.persona, '谨慎但敢于质疑。');
  assert.equal(two.context.self.persona, undefined);
  assert.equal(two.context.self.seat, 2);
  assert.ok(one.options.length > 0);
  assert.ok(two.options.length > 0);
  assert.equal(one.context.current_action.request_type, 'SELECT');
  assert.ok(!JSON.stringify(one.context).includes('modelProfile'));
  assert.ok(!JSON.stringify(two.context).includes('environment-default'));
  room.phaseActionDeadlineAt = 65_000;
  assert.equal(prepareWerewolfDecision(room, 1, definition).context.current_action.deadlineAt, 65_000);
});

test('model facts separate the peaceful public night from a wolf private knife target', () => {
  const definition = werewolfDefinition({ seed: 42, sheriff: 'double' });
  let room = createRoom('peaceful-room', 'peaceful-run', definition);
  for (let seat = 1; seat <= 12; seat++) room = occupySeat(room, {
    seat, name: `${seat}号`, modelProfile: 'script-random',
    scopeId: `scope-${seat}`, interruptScopeId: `interrupt-${seat}`,
  }, definition);
  const players = (room.state as unknown as Match).game.players;
  const wolf = players.find(player => player.role === 'wolf')!.seat;
  const villager = players.find(player => player.role === 'villager')!.seat;
  type PublicFacts = { last_announced_night: {night:number; deaths:number[]; peaceful:boolean} | null; players: {seat:number; alive:boolean}[] };
  type PrivateFacts = { events: {data:unknown}[] };
  assert.equal((prepareWerewolfDecision(room, wolf, definition).context.game_state as PublicFacts).last_announced_night, null);
  room.phase = {...room.phase!, key:'speech', actors:[wolf, villager], schema:{type:'object',properties:{text:{type:'string'}}}};
  room.events = [
    {sequence:1, phaseInstance:1, type:'wolf-knife', audience:[wolf], data:{night:1,target:12}},
    {sequence:2, phaseInstance:1, type:'night-deaths', audience:'public', data:{seats:[]}},
  ];
  const wolfTask = prepareWerewolfDecision(room, wolf, definition);
  const villagerTask = prepareWerewolfDecision(room, villager, definition);
  assert.deepEqual((wolfTask.context.game_state as PublicFacts).last_announced_night, {night:1,deaths:[],peaceful:true});
  assert.deepEqual((villagerTask.context.game_state as PublicFacts).last_announced_night, {night:1,deaths:[],peaceful:true});
  assert.deepEqual((wolfTask.context.private_information as PrivateFacts).events[0].data, {night:1,target:12});
  assert.equal((villagerTask.context.private_information as PrivateFacts).events.length, 0);
  assert.equal((wolfTask.context.game_state as PublicFacts).players.find(player => player.seat === 12)?.alive, true);
  assert.match(JSON.stringify(wolfTask.context.rules), /平民.*公开.*刀口.*不代表.*死亡/s);
  assert.equal(JSON.stringify(villagerTask.context).includes('wolf-knife'), false);
});

test('every live Werewolf phase exposes a decodable SPEAK or SELECT task', () => {
  const definition = werewolfDefinition({ seed: 42, sheriff: 'double' });
  let room = createRoom('all-phases', 'all-phases', definition);
  for (let seat = 1; seat <= 12; seat++) room = occupySeat(room, {
    seat, name: `${seat}号`, modelProfile: 'script-random',
    scopeId: `scope-${seat}`, interruptScopeId: `interrupt-${seat}`,
  }, definition);
  const seen = new Set<string>();
  for (let count = 0; room.status === 'running' && count < 600; count++) {
    const actor = eligibleActors(room)[0];
    const task = prepareWerewolfDecision(room, actor, definition);
    assert.equal(task.audit?.seatNo, actor);
    assert.equal(task.audit?.role, task.context.self.role);
    if (task.intent === 'SPEAK') assert.ok(Number.isInteger(task.audit?.micNo) && task.audit!.micNo! > 0,
      `${task.scene} must record its speaking order`);
    else assert.equal(task.audit?.micNo, null);
    const publicEvents = task.context.public_history as { sequence: number }[];
    assert.deepEqual(publicEvents.map(event => event.sequence), publicEvents.map((_, index) => index + 1));
    seen.add(task.scene);
    const output = task.intent === 'SPEAK'
      ? { kind: 'proposal' as const, value: { speech: '本轮我会谨慎判断。' } }
      : { kind: 'proposal' as const, value: { selected: task.options[0].id } };
    const action = decodeWerewolfDecision(task, output);
    assert.ok(action, `${task.scene} must decode to a game action`);
    room = acceptDecision(room, room.phaseInstance, actor, action, definition);
  }
  assert.equal(room.status, 'finished');
  assert.ok(seen.has('wolves'));
  assert.ok(seen.has('speech'));
  assert.ok(seen.has('vote'));
});
