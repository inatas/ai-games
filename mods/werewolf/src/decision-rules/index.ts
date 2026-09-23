import { compileDecisionRuleSet } from '@game-ai/turn-based';
import authorRules from '../../rules/ruleset.json' with { type: 'json' };
import { werewolfRuleHandlers } from './handlers.ts';

export const werewolfDecisionRules = compileDecisionRuleSet(authorRules, werewolfRuleHandlers);
