import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptDecision, createRoom, occupySeat, type Room } from '@game-ai/turn-based';
import { werewolfDefinition } from '../src/definition.ts';
import { fallbackWerewolfAction } from '../src/fallback.ts';
import type { Match } from '../src/match.ts';

function ready(seed: number): { room: Room; definition: ReturnType<typeof werewolfDefinition> } {
  const definition = werewolfDefinition({ seed, sheriff: 'double' });
  let room = createRoom(`room-${seed}`, `run-${seed}`, definition);
  for (let seat = 1; seat <= 12; seat++) room = occupySeat(room, {
    seat, name: `${seat}`, modelProfile: 'script', scopeId: `scope-${seat}`, interruptScopeId: `interrupt-${seat}`,
  }, definition);
  return { room, definition };
}

test('confirmed deadline defaults are legal for every ordinary Werewolf scene and deterministic for seer', () => {
  let { room, definition } = ready(912);
  let seerChecked = false;
  let speechChecked = false;
  for (let step = 0; step < 800 && room.status === 'running'; step++) {
    const seat = room.phase!.actors.find(actor => !room.decisions.some(decision => decision.seat === actor))!;
    const action = fallbackWerewolfAction(room, seat, definition);
    assert.deepEqual(action, fallbackWerewolfAction(structuredClone(room), seat, definition));
    const role = (room.state as unknown as Match).game.players.find(player => player.seat === seat)!.role;
    if (room.phase!.key === 'wolves' && role === 'seer') {
      assert.equal((action as { kind: string }).kind, 'inspect');
      const sameSeedRoom = structuredClone(room);
      sameSeedRoom.id = 'another-room-id';
      assert.deepEqual(action, fallbackWerewolfAction(sameSeedRoom, seat, definition));
      seerChecked = true;
    }
    if (['speech', 'pk', 'last-words', 'election-speech', 'election-pk'].includes(room.phase!.key)) {
      assert.equal((action as { text: string }).text, '');
      speechChecked = true;
    }
    room = acceptDecision(room, room.phaseInstance, seat, action, definition);
  }
  assert.ok(['running', 'finished', 'aborted'].includes(room.status));
  assert.ok(seerChecked);
  assert.ok(speechChecked);
});
