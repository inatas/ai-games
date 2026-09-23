import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDecisionRules, type DecisionRuleSet, type DecisionInput } from '../src/index.ts';

const input: DecisionInput = {
  actor: { roomId: 'room-a', seat: 2, phaseInstance: 1 }, intent: 'SELECT', scene: 'choose',
  options: [{ id: 'a', value: { choice: 'A' } }, { id: 'b', value: { choice: 'B' } }],
  outputSchema: {},
  context: {
    rules: {}, game_state: {}, self: { seat: 2, name: 'Second', role: 'special' },
    private_information: {}, public_history: {},
    current_action: { request_type: 'SELECT', scene: 'choose', options: [], phaseInstance: 1 },
  },
};

const set: DecisionRuleSet = {
  id: 'neutral', version: 1,
  rules: [{ id: 'choose-a', priority: 100, probability: 1, mode: 'require-option',
    matches: task => task.context.self.role === 'special',
    selectOption: () => 'a' }],
};

test('DR-01/02: a MOD rule can only require an existing legal option', () => {
  assert.equal(evaluateDecisionRules(set, input).requiredOptionId, 'a');
  assert.deepEqual(evaluateDecisionRules(set, input).allowedOptionIds, ['a']);
  assert.deepEqual(evaluateDecisionRules({ ...set, rules: [{ ...set.rules[0]!, selectOption: () => 'missing' }] }, input).allowedOptionIds, ['a', 'b']);
});

test('DR-03/04: conflicts fail, probability is stable for a decision occurrence', () => {
  assert.throws(() => evaluateDecisionRules({ ...set, rules: [set.rules[0]!, {
    ...set.rules[0]!, id: 'choose-b', selectOption: () => 'b',
  }] }, input), /RULE_CONFLICT/);
  const probabilistic = { ...set, rules: [{ ...set.rules[0]!, probability: 0.8 }] };
  assert.deepEqual(evaluateDecisionRules(probabilistic, input), evaluateDecisionRules(probabilistic, input));
});

test('DR-06: non-triggering rule leaves original options', () => {
  assert.deepEqual(evaluateDecisionRules({ ...set, rules: [{ ...set.rules[0]!, matches: () => false }] }, input).allowedOptionIds, ['a', 'b']);
});
