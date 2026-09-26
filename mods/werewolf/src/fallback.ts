import { createHash } from 'node:crypto';
import type { Json } from '@game-ai/core';
import { validateDecision, type Room, type RoomDefinition } from '@game-ai/turn-based';
import { prepareWerewolfDecision } from './decision-input.ts';

/** The game's deadline ruling; controller failures do not choose this action. */
export function fallbackWerewolfAction(room: Room, seat: number, definition: RoomDefinition): Json {
  const task = prepareWerewolfDecision(room, seat, definition);
  if (task.intent === 'SPEECH') {
    const action = { kind: task.scene === 'last-words' ? 'last-words' : 'speech', text: '' };
    validateDecision(room, room.phaseInstance, seat, action, definition);
    return action;
  }
  const actions = task.options.map(option => option.value as Record<string, Json>);
  const kind = actions[0]?.kind;
  const preferred = kind === 'inspect' ? actions.filter(action => action.kind === 'inspect')
    : kind === 'knife' ? actions.filter(action => action.kind === 'knife' && action.target === null)
    : kind === 'nominate' ? actions.filter(action => action.run === false)
    : kind === 'direction' ? actions.filter(action => action.direction === 'counterclockwise')
    : kind === 'withdraw' ? actions.filter(action => action.withdraw === false)
    : actions.filter(action => action.kind === 'pass' || action.target === null);
  if (!preferred.length) throw new Error('MISSING_GAME_DEFAULT');
  const hash = createHash('sha256').update(`${definition.version}:${room.phaseInstance}:${seat}`).digest();
  const action = preferred[hash.readUInt32BE(0) % preferred.length];
  validateDecision(room, room.phaseInstance, seat, action, definition);
  return structuredClone(action);
}
