import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, occupySeat } from '@game-ai/turn-based';
import { werewolfDefinition } from '../src/definition.ts';

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
