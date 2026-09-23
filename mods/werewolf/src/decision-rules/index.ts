import type { DecisionRuleSet } from '@game-ai/turn-based';
import { seerFirstDayRun } from './seer-first-day.ts';

export const werewolfDecisionRules: DecisionRuleSet = {
  id: 'werewolf.robot-strategy', version: 1,
  rules: [seerFirstDayRun],
};
