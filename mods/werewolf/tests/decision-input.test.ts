import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptDecision, createRoom, eligibleActors, occupySeat } from '@game-ai/turn-based';
import { werewolfDefinition } from '../src/definition.ts';
import { prepareWerewolfDecision } from '../src/decision-input.ts';
import { decodeWerewolfDecision } from '../src/decision-adapter.ts';
import type { Match } from '../src/match.ts';

test('script and model seats receive the same six-part authorized SPEECH/SELECT contract', () => {
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
  assert.deepEqual(Object.keys(one.context.rules as object).sort(), ['fact_boundaries', 'version']);
  assert.equal(JSON.stringify(one.context).includes(definition.instructions), false);
  assert.ok(!JSON.stringify(one.context).includes('modelProfile'));
  assert.ok(!JSON.stringify(two.context).includes('environment-default'));
  room.phaseActionDeadlineAt = 65_000;
  assert.equal(prepareWerewolfDecision(room, 1, definition).context.current_action.deadlineAt, 65_000);
});

test('WW-C4-01/03: game_state is an explicit public allowlist, with seat-specific phase kept in current_action', () => {
  const definition = werewolfDefinition({ seed: 42, sheriff: 'double' });
  let room = createRoom('public-state', 'public-state', definition);
  for (let seat = 1; seat <= 12; seat++) room = occupySeat(room, {
    seat, name: `${seat}号`, modelProfile: 'script-random',
    scopeId: `scope-${seat}`, interruptScopeId: `interrupt-${seat}`,
  }, definition);
  const injectedDefinition = { ...definition, project: (state: Parameters<typeof definition.project>[0], viewer: number | null) => {
    const projected = definition.project(state, viewer) as { players: { seat: number; alive: boolean }[] };
    return { ...projected, futurePrivateField: { secret: 'DO_NOT_SHARE' },
      players: projected.players.map(player => ({ ...player, privateDiagnosis: 'DO_NOT_SHARE' })) };
  } };
  const one = prepareWerewolfDecision(room, 1, injectedDefinition);
  const two = prepareWerewolfDecision(room, 2, injectedDefinition);
  assert.deepEqual(one.context.game_state, two.context.game_state);
  assert.deepEqual(Object.keys(one.context.game_state as object).sort(),
    ['day', 'last_announced_night', 'night', 'period', 'players', 'seats', 'sheriff']);
  assert.equal(JSON.stringify(one.context.game_state).includes('DO_NOT_SHARE'), false);
  assert.equal(JSON.stringify(one.context.game_state).includes('phaseInstance'), false);
  assert.equal(one.context.current_action.scene, room.phase?.key);
  assert.equal(one.context.current_action.phaseInstance, room.phaseInstance);
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
  assert.equal(wolfTask.intent, 'SPEECH');
  assert.equal(wolfTask.context.current_action.request_type, 'SPEECH');
  assert.equal((wolfTask.outputSchema as { properties: { speech: { maxLength: number } } }).properties.speech.maxLength, 200);
  assert.deepEqual((wolfTask.context.game_state as PublicFacts).last_announced_night, {night:1,deaths:[],peaceful:true});
  assert.deepEqual((villagerTask.context.game_state as PublicFacts).last_announced_night, {night:1,deaths:[],peaceful:true});
  assert.deepEqual((wolfTask.context.private_information as PrivateFacts).events[0].data, {night:1,target:12});
  assert.equal((villagerTask.context.private_information as PrivateFacts).events.length, 0);
  assert.equal((wolfTask.context.game_state as PublicFacts).players.find(player => player.seat === 12)?.alive, true);
  assert.match(JSON.stringify(wolfTask.context.rules), /公开状态.*发言.*不证明.*刀口.*死亡/s);
  assert.equal(JSON.stringify(villagerTask.context).includes('wolf-knife'), false);
});

test('model history contains settled public speech and ballots, not pending private decisions', () => {
  const definition = werewolfDefinition({ seed: 42, sheriff: 'double' });
  let room = createRoom('fact-room', 'fact-run', definition);
  for (let seat = 1; seat <= 12; seat++) room = occupySeat(room, {
    seat, name: `${seat}号`, modelProfile: 'script-random',
    scopeId: `scope-${seat}`, interruptScopeId: `interrupt-${seat}`,
  }, definition);
  const wolf = (room.state as unknown as Match).game.players.find(player => player.role === 'wolf')!.seat;
  room.phase = { ...room.phase!, key: 'speech', actors: [wolf], schema: { type: 'object', properties: { text: { type: 'string' } } } };
  room.events = [
    { sequence: 1, phaseInstance: 1, type: 'speech', audience: 'public', data: { seat: 2, text: '我是预言家' } },
    { sequence: 2, phaseInstance: 1, type: 'decision', audience: [wolf], data: { seat: wolf, value: { kind: 'knife', target: 5 } } },
    { sequence: 3, phaseInstance: 1, type: 'sheriff-ballot', audience: 'after-game', data: { seat: 2, target: 3 } },
    { sequence: 4, phaseInstance: 1, type: 'exile-votes', audience: 'public', data: {
      winner: 5, tied: [], totals: [{ seat: 5, votes: 1 }],
      ballots: [{ seat: 2, target: 5, kind: 'vote' }, { seat: 3, target: null, kind: 'abstain' }],
    } },
  ];
  const task = prepareWerewolfDecision(room, wolf, definition);
  const publicHistory = task.context.public_history as { type: string; record_kind: string; data: { ballots?: unknown[] } }[];
  const privateHistory = (task.context.private_information as { events: { type: string }[] }).events;
  assert.deepEqual(publicHistory.filter(event => event.type).map(event => event.type), ['speech', 'exile-votes']);
  assert.equal(publicHistory[0].record_kind, 'player-statement');
  const votes = publicHistory.find(event => event.type === 'exile-votes')!;
  assert.equal(votes.record_kind, 'referee-result');
  assert.deepEqual(votes.data.ballots, [
    { seat: 2, target: 5, kind: 'vote' }, { seat: 3, target: null, kind: 'abstain' },
  ]);
  assert.deepEqual(privateHistory, []);
});

test('private history reports executed medicine and the real outcome of a wolf knife', () => {
  const definition = werewolfDefinition({ seed: 42, sheriff: 'double' });
  let room = createRoom('night-facts', 'night-facts', definition);
  for (let seat = 1; seat <= 12; seat++) room = occupySeat(room, {
    seat, name: `${seat}号`, modelProfile: 'script-random',
    scopeId: `scope-${seat}`, interruptScopeId: `interrupt-${seat}`,
  }, definition);
  const players = (room.state as unknown as Match).game.players;
  const wolf = players.find(player => player.role === 'wolf')!.seat;
  const witch = players.find(player => player.role === 'witch')!.seat;
  const target = players.find(player => player.role === 'villager')!.seat;
  room.phase = { ...room.phase!, key: 'speech', actors: [wolf, witch], schema: { type: 'object', properties: { text: { type: 'string' } } } };
  room.events = [
    { sequence: 1, phaseInstance: 1, type: 'decision', audience: [witch], data: { seat: witch, value: { kind: 'pass' } } },
    { sequence: 2, phaseInstance: 1, type: 'wolf-knife', audience: [wolf], data: { night: 1, target } },
    { sequence: 3, phaseInstance: 1, type: 'medicine', audience: [witch], data: { seat: witch, action: { kind: 'pass' } } },
    { sequence: 4, phaseInstance: 1, type: 'night-deaths', audience: 'public', data: { seats: [witch] } },
  ];
  const wolfTask = prepareWerewolfDecision(room, wolf, definition);
  const witchTask = prepareWerewolfDecision(room, witch, definition);
  const wolfEvents = (wolfTask.context.private_information as { events: { type: string; result?: unknown }[] }).events;
  const witchEvents = (witchTask.context.private_information as { events: { type: string; result?: unknown }[] }).events;
  assert.deepEqual(wolfEvents.map(event => event.type), ['wolf-knife']);
  assert.deepEqual(wolfEvents[0].result, {
    status: 'settled', target_alive_after_night: true, caused_death: false, saved_by_antidote: true,
  });
  assert.deepEqual(witchEvents.map(event => event.type), ['medicine']);
  assert.deepEqual(witchEvents[0].result, { status: 'settled', effect: 'no-medicine-used' });
  assert.equal(JSON.stringify(witchTask.context).includes('"type":"decision"'), false);
  assert.equal(JSON.stringify(wolfTask.context).includes('"type":"medicine"'), false);
});

test('a decided knife remains current intel until the night result is announced', () => {
  const definition = werewolfDefinition({ seed: 42, sheriff: 'double' });
  let room = createRoom('pending-knife', 'pending-knife', definition);
  for (let seat = 1; seat <= 12; seat++) room = occupySeat(room, {
    seat, name: `${seat}号`, modelProfile: 'script-random',
    scopeId: `scope-${seat}`, interruptScopeId: `interrupt-${seat}`,
  }, definition);
  const wolf = (room.state as unknown as Match).game.players.find(player => player.role === 'wolf')!.seat;
  room.phase = { ...room.phase!, key: 'nominations', actors: [wolf], schema: { type: 'object', properties: { kind: { const: 'nominate' }, run: { type: 'boolean' } } } };
  room.events = [{ sequence: 1, phaseInstance: 1, type: 'wolf-knife', audience: [wolf], data: { night: 1, target: 5 } }];
  const task = prepareWerewolfDecision(room, wolf, definition);
  const privateFacts = task.context.private_information as { events: unknown[]; current_intel: unknown };
  assert.deepEqual(privateFacts.events, []);
  assert.deepEqual(privateFacts.current_intel, { kind: 'wolf-knife-target', night: 1, target: 5, outcome: 'pending' });
});

test('the witch sees the target and settled survival of her own antidote', () => {
  const definition = werewolfDefinition({ seed: 42, sheriff: 'none' });
  let room = createRoom('saved-facts', 'saved-facts', definition);
  for (let seat = 1; seat <= 12; seat++) room = occupySeat(room, {
    seat, name: `${seat}号`, modelProfile: 'script-random',
    scopeId: `scope-${seat}`, interruptScopeId: `interrupt-${seat}`,
  }, definition);
  const players = (room.state as unknown as Match).game.players;
  const witch = players.find(player => player.role === 'witch')!.seat;
  const target = players.find(player => player.role === 'villager')!.seat;
  room.phase = { ...room.phase!, key: 'speech', actors: [witch], schema: { type: 'object', properties: { text: { type: 'string' } } } };
  room.events = [
    { sequence: 1, phaseInstance: 1, type: 'medicine', audience: [witch], data: { seat: witch, action: { kind: 'save' }, target } },
    { sequence: 2, phaseInstance: 1, type: 'night-deaths', audience: 'public', data: { seats: [] } },
  ];
  const task = prepareWerewolfDecision(room, witch, definition);
  const actions = (task.context.private_information as { events: { type: string; data: unknown; result: unknown }[] }).events;
  assert.deepEqual(actions[0].data, { seat: witch, action: { kind: 'save' }, target });
  assert.deepEqual(actions[0].result, { status: 'settled', effect: 'antidote-applied', target_alive_after_night: true });
});

test('WW-WK02/04/06: public role claims do not replace real roles, private guides or skill facts', () => {
  const definition = werewolfDefinition({ seed: 42, sheriff: 'double' });
  let room = createRoom('tactical-claims', 'tactical-claims', definition);
  for (let seat = 1; seat <= 12; seat++) room = occupySeat(room, {
    seat, name: `${seat}号`, modelProfile: 'script-random',
    scopeId: `scope-${seat}`, interruptScopeId: `interrupt-${seat}`,
  }, definition);
  const players = (room.state as unknown as Match).game.players;
  const wolf = players.find(player => player.role === 'wolf')!.seat;
  const target = players.find(player => player.role === 'villager')!.seat;
  const speech = `我是预言家，${target}号是我查验的金水。`;
  room.phase = { ...room.phase!, key: 'speech', actors: players.map(player => player.seat), schema: {
    type: 'object', properties: { text: { type: 'string' } },
  } };
  room.events = [{ sequence: 1, phaseInstance: 1, type: 'speech', audience: 'public',
    data: { seat: wolf, text: speech } }];
  for (const player of players) {
    const task = prepareWerewolfDecision(room, player.seat, definition);
    assert.equal(task.context.self.role, player.role);
    assert.equal(task.privateKnowledge?.id, `guide:${player.role}`);
    assert.match(task.sharedKnowledge!.find(entry => entry.id === 'role:seer')!.content, /警徽流/);
  }
  const task = prepareWerewolfDecision(room, wolf, definition);
  const privateFacts = task.context.private_information as { events: { type: string }[] };
  assert.equal(privateFacts.events.some(event => event.type === 'inspection'), false);
  assert.deepEqual(decodeWerewolfDecision(task, { kind: 'proposal', value: { speech } }),
    { kind: 'speech', text: speech });
});

test('every live Werewolf phase exposes a decodable SPEECH or SELECT task', () => {
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
    if (task.intent === 'SPEECH') assert.ok(Number.isInteger(task.audit?.micNo) && task.audit!.micNo! > 0,
      `${task.scene} must record its speaking order`);
    else assert.equal(task.audit?.micNo, null);
    const publicEvents = (task.context.public_history as { sequence?: number }[])
      .filter((event): event is { sequence: number } => typeof event.sequence === 'number');
    assert.ok(publicEvents.every((event, index) => index === 0 || event.sequence > publicEvents[index - 1].sequence));
    seen.add(task.scene);
    const output = task.intent === 'SPEECH'
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
