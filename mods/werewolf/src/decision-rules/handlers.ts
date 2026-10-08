import type { RuleHandlerRegistry } from '@game-ai/turn-based';

/** Game-specific interpretation of stable author rule IDs. Not an authoring surface. */
export const werewolfRuleHandlers: RuleHandlerRegistry = {
  'seer-first-day-run': {
    matches: input => input.intent === 'SELECT' && input.scene === 'nominations' &&
      input.context.self.role === 'seer' &&
      (input.context.game_state as { day?: number }).day === 1,
    selectOption: input => input.options.find(option => {
      const value = option.value as { kind?: string; run?: boolean };
      return value.kind === 'nominate' && value.run === true;
    })?.id ?? null,
  },
  'speech-language': {
    matches: input => input.intent === 'SPEECH' &&
      ['speech', 'election-speech', 'pk', 'election-pk', 'last-words', 'wolf-team-proposal'].includes(input.scene),
  },
};
