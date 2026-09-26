import { compileDecisionRuleSet } from '@game-ai/turn-based';
import { createHash } from 'node:crypto';
import { canonical, type Json } from '@game-ai/core';
import authorRules from '../../rules/ruleset.json' with { type: 'json' };
import { werewolfRuleHandlers } from './handlers.ts';

const { id, version, rules, speech, ...extra } = authorRules;
if (Object.keys(extra).length || !speech || Object.keys(speech).join(',') !== 'maxChars' ||
    !Number.isSafeInteger(speech.maxChars) || speech.maxChars < 1) throw new Error('INVALID_RULE_SET');
export const werewolfDecisionRules = {
  ...compileDecisionRuleSet({ id, version, rules }, werewolfRuleHandlers),
  digest: createHash('sha256').update(canonical(authorRules as unknown as Json)).digest('hex'),
};
