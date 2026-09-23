import type { RuleHandlerRegistry } from '@game-ai/turn-based';

/** Game-specific interpretation of stable author rule IDs. Not an authoring surface. */
export const werewolfRuleHandlers: RuleHandlerRegistry = {
  'seer-first-day-run': {
    matches: input => input.intent === 'SELECT' && input.scene === 'nominations' &&
      input.context.self.role === 'seer' &&
      (input.context.game_state as { phase?: { round?: number } }).phase?.round === 1,
    selectOption: input => input.options.find(option => {
      const value = option.value as { kind?: string; run?: boolean };
      return value.kind === 'nominate' && value.run === true;
    })?.id ?? null,
  },
};
