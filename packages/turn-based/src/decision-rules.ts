import { createHash } from 'node:crypto';
import { HarnessError } from '@game-ai/core';
import type { DecisionInput } from './decision.ts';

/** Trusted game code. Rule callbacks must be pure and read only this seat's authorized task. */
export interface DecisionRule {
  id: string;
  priority: number;
  mode: 'require-option' | 'prefer-option';
  probability?: number;
  matches(input: DecisionInput): boolean;
  selectOption(input: DecisionInput): string | null;
}

export interface DecisionRuleSet {
  id: string;
  version: number;
  rules: readonly DecisionRule[];
}

export interface RuleEvaluation {
  allowedOptionIds: string[];
  requiredOptionId?: string;
  preferredOptionIds: string[];
  results: Array<{ id: string; sampled: boolean; matched: boolean; selected?: string }>;
}

export function assertDecisionRuleSet(set: DecisionRuleSet): void {
  if (!set.id || !Number.isSafeInteger(set.version) || set.version < 1 || !Array.isArray(set.rules)) {
    throw new HarnessError('INVALID_RULE_SET');
  }
  const ids = new Set<string>();
  for (const rule of set.rules) {
    if (!rule.id || ids.has(rule.id) || !Number.isSafeInteger(rule.priority) ||
        !['require-option', 'prefer-option'].includes(rule.mode) ||
        (rule.probability !== undefined && (!Number.isFinite(rule.probability) || rule.probability < 0 || rule.probability > 1)) ||
        typeof rule.matches !== 'function' || typeof rule.selectOption !== 'function') {
      throw new HarnessError('INVALID_RULE_SET');
    }
    ids.add(rule.id);
  }
}

function sampled(set: DecisionRuleSet, rule: DecisionRule, input: DecisionInput): boolean {
  const threshold = rule.probability ?? 1;
  if (threshold === 0) return false;
  if (threshold === 1) return true;
  const { roomId, seat, phaseInstance } = input.actor;
  const key = JSON.stringify([roomId, seat, phaseInstance, set.id, set.version, rule.id]);
  const value = createHash('sha256').update(key).digest().readUInt32BE(0) / 0x1_0000_0000;
  return value < threshold;
}

/** Stable evaluation. A rule never creates a new game action or grants hidden information. */
export function evaluateDecisionRules(set: DecisionRuleSet, input: DecisionInput): RuleEvaluation {
  assertDecisionRuleSet(set);
  const original = input.options.map(option => option.id);
  const legal = new Set(original);
  const result: RuleEvaluation = { allowedOptionIds: original, preferredOptionIds: [], results: [] };
  if (input.intent !== 'SELECT') return result;
  const ordered = [...set.rules].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  for (const rule of ordered) {
    const matches = rule.matches(input);
    const hit = matches && sampled(set, rule, input);
    const id = hit ? rule.selectOption(input) : null;
    result.results.push({ id: rule.id, sampled: hit, matched: matches, ...(id ? { selected: id } : {}) });
    if (!id || !legal.has(id)) continue;
    if (rule.mode === 'prefer-option') { result.preferredOptionIds.push(id); continue; }
    if (result.requiredOptionId && result.requiredOptionId !== id) throw new HarnessError('RULE_CONFLICT');
    result.requiredOptionId = id;
  }
  if (result.requiredOptionId) result.allowedOptionIds = [result.requiredOptionId];
  return result;
}
