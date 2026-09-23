import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptDecision, createRoom, eligibleActors, occupySeat } from '@game-ai/turn-based';
import { werewolfDefinition } from '../src/definition.ts';
import { prepareWerewolfDecision } from '../src/decision-input.ts';
import { decodeWerewolfDecision } from '../src/decision-adapter.ts';

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
