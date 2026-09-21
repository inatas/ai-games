import type { RoomDefinition } from '@game-ai/turn-based';
import { choiceGame } from './turn-based.ts';

/** Neutral interrupt fixture: replace a choice round with another choice round. */
export const interruptGame: RoomDefinition = {
  ...choiceGame, id: 'interrupt-choice', version: '2',
  initialize: seats => {
    const initial = choiceGame.initialize(seats);
    return { ...initial, phase: { ...initial.phase, interrupt: {
      key: 'replace', actors: [1, 2], schema: {
        type: 'object', additionalProperties: false, required: ['kind'],
        properties: { kind: { enum: ['pass', 'replace'] } },
      },
    } } };
  },
  validateInterrupt: () => true,
  resolveInterrupt: (state, phase, seat, value) => (value as { kind: string }).kind === 'pass'
    ? { pass: true }
    : { state, phase: { ...phase, key: 'replaced', round: phase.round + 1 },
      events: [{ type: 'replacement', audience: 'public', data: { seat } }] },
};
