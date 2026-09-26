import { createHash } from 'node:crypto';
import { HarnessError, canonical } from '@game-ai/core';
import type { DecisionInput } from './decision.ts';

/** Trusted game code. Rule callbacks must be pure and read only this seat's authorized task. */
export interface DecisionRule {
  id: string;
  priority: number;
  mode: 'require-option' | 'guidance';
  instruction?: string;
  probability?: number;
  placement?: 'stable';
  matches(input: DecisionInput): boolean;
  selectOption?(input: DecisionInput): string | null;
}

export interface DecisionRuleSet {
  id: string;
  version: number;
  digest?: string;
  rules: readonly DecisionRule[];
}

export interface RuleConfig {
  id: string;
  priority: number;
  instruction: string;
  enforcement: 'guidance' | 'require-option';
  probability?: number;
  placement?: 'stable';
}

export interface RuleSetConfig { id: string; version: number; rules: RuleConfig[] }
export interface RuleHandler {
  matches(input: DecisionInput): boolean;
  selectOption?(input: DecisionInput): string | null;
}
export type RuleHandlerRegistry = Readonly<Record<string, RuleHandler>>;

export interface RuleEvaluation {
  allowedOptionIds: string[];
  requiredOptionId?: string;
  guidance: Array<{ id: string; priority: number; instruction: string; placement?: 'stable' }>;
  results: Array<{ id: string; sampled: boolean; matched: boolean; selected?: string }>;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key));
}

/** Compile small, human-authored data against trusted game handlers. Never evaluate source text. */
export function compileDecisionRuleSet(source: unknown, handlers: RuleHandlerRegistry): DecisionRuleSet {
  if (!record(source) || !onlyKeys(source, ['id', 'version', 'rules']) ||
      typeof source.id !== 'string' || !source.id.trim() ||
      !Number.isSafeInteger(source.version) || (source.version as number) < 1 ||
      !Array.isArray(source.rules)) throw new HarnessError('INVALID_RULE_SET');
  const rules: DecisionRule[] = [];
  for (const raw of source.rules) {
    if (!record(raw) || !onlyKeys(raw, ['id', 'priority', 'instruction', 'enforcement', 'probability', 'placement']) ||
        typeof raw.id !== 'string' || !raw.id.trim() ||
        !Number.isSafeInteger(raw.priority) ||
        typeof raw.instruction !== 'string' || !raw.instruction.trim() || raw.instruction.length > 500 ||
        !['guidance', 'require-option'].includes(raw.enforcement as string) ||
        (raw.placement !== undefined && (raw.placement !== 'stable' || raw.enforcement !== 'guidance')) ||
        (raw.probability !== undefined && (raw.enforcement !== 'require-option' ||
          typeof raw.probability !== 'number' || !Number.isFinite(raw.probability) ||
          raw.probability < 0 || raw.probability > 1))) throw new HarnessError('INVALID_RULE_SET');
    const handler = handlers[raw.id];
    if (!handler) throw new HarnessError('UNKNOWN_RULE_HANDLER');
    if (typeof handler.matches !== 'function' ||
        (raw.enforcement === 'require-option' && typeof handler.selectOption !== 'function')) {
      throw new HarnessError('INVALID_RULE_HANDLER');
    }
    rules.push({
      id: raw.id, priority: raw.priority as number, instruction: raw.instruction,
      mode: raw.enforcement as DecisionRule['mode'],
      ...(raw.probability === undefined ? {} : { probability: raw.probability as number }),
      ...(raw.placement === undefined ? {} : { placement: 'stable' as const }),
      matches: handler.matches, ...(handler.selectOption ? { selectOption: handler.selectOption } : {}),
    });
  }
  const set: DecisionRuleSet = {
    id: source.id, version: source.version as number,
    digest: createHash('sha256').update(canonical(source as import('@game-ai/core').Json)).digest('hex'),
    rules,
  };
  assertDecisionRuleSet(set);
  return set;
}

export function assertDecisionRuleSet(set: DecisionRuleSet): void {
  if (!set.id || !Number.isSafeInteger(set.version) || set.version < 1 || !Array.isArray(set.rules)) {
    throw new HarnessError('INVALID_RULE_SET');
  }
  const ids = new Set<string>();
  for (const rule of set.rules) {
    if (!rule.id || ids.has(rule.id) || !Number.isSafeInteger(rule.priority) ||
        !['require-option', 'guidance'].includes(rule.mode) ||
        (rule.instruction !== undefined && (typeof rule.instruction !== 'string' || !rule.instruction.trim())) ||
        (rule.probability !== undefined && (!Number.isFinite(rule.probability) || rule.probability < 0 || rule.probability > 1)) ||
        (rule.placement !== undefined && (rule.placement !== 'stable' || rule.mode !== 'guidance')) ||
        typeof rule.matches !== 'function' ||
        (rule.mode === 'require-option' && typeof rule.selectOption !== 'function')) {
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
  const result: RuleEvaluation = { allowedOptionIds: original, guidance: [], results: [] };
  const ordered = [...set.rules].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  for (const rule of ordered) {
    const matches = rule.matches(input);
    if (matches && rule.instruction) result.guidance.push({ id: rule.id, priority: rule.priority, instruction: rule.instruction,
      ...(rule.placement ? { placement: rule.placement } : {}) });
    const hit = matches && (rule.mode === 'guidance' || sampled(set, rule, input));
    if (hit && rule.mode === 'require-option' && input.intent !== 'SELECT') throw new HarnessError('RULE_INTENT_MISMATCH');
    const id = hit && rule.mode === 'require-option' ? rule.selectOption!(input) : null;
    result.results.push({ id: rule.id, sampled: hit, matched: matches, ...(id ? { selected: id } : {}) });
    if (!id || !legal.has(id)) continue;
    if (result.requiredOptionId && result.requiredOptionId !== id) throw new HarnessError('RULE_CONFLICT');
    result.requiredOptionId = id;
  }
  if (result.requiredOptionId) result.allowedOptionIds = [result.requiredOptionId];
  return result;
}
