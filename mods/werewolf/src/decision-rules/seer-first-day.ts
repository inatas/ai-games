import type { DecisionRule } from '@game-ai/turn-based';

/** A first-day seer runs for sheriff in 80% of games when the legal option exists. */
export const seerFirstDayRun: DecisionRule = {
  id: 'seer-first-day-run', priority: 100, mode: 'require-option', probability: 0.8,
  matches: input => input.intent === 'SELECT' && input.scene === 'nominations' &&
    input.context.self.role === 'seer' &&
    (input.context.game_state as { phase?: { round?: number } }).phase?.round === 1,
  selectOption: input => input.options.find(option => {
    const value = option.value as { kind?: string; run?: boolean };
    return value.kind === 'nominate' && value.run === true;
  })?.id ?? null,
};
