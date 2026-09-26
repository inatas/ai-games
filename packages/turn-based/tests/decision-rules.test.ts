import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileDecisionRuleSet, evaluateDecisionRules, type DecisionRuleSet, type DecisionInput } from '../src/index.ts';

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

test('DR-v2: plain author config compiles against trusted handlers and fixes its text digest', () => {
  const config = { id: 'neutral', version: 2, rules: [{
    id: 'choose-a', priority: 100, instruction: 'Prefer A when this role is active.',
    enforcement: 'guidance',
  }] };
  const handlers = { 'choose-a': { matches: (task: DecisionInput) => task.context.self.role === 'special' } };
  const compiled = compileDecisionRuleSet(config, handlers);
  assert.equal(compiled.rules[0]?.mode, 'guidance');
  assert.deepEqual(evaluateDecisionRules(compiled, input).guidance, [
    { id: 'choose-a', priority: 100, instruction: 'Prefer A when this role is active.' },
  ]);
  assert.notEqual(compiled.digest, compileDecisionRuleSet({ ...config, rules: [{ ...config.rules[0], instruction: 'Choose B.' }] }, handlers).digest);
  assert.throws(() => compileDecisionRuleSet({ ...config, rules: [{ ...config.rules[0], unsupported: true }] }, handlers), /INVALID_RULE_SET/);
  assert.throws(() => compileDecisionRuleSet(config, {}), /UNKNOWN_RULE_HANDLER/);
});

test('DR-v2: a hard rule keeps guidance on a probability miss and validates its option handler', () => {
  const config = { id: 'neutral', version: 2, rules: [{
    id: 'choose-a', priority: 100, instruction: 'Usually choose A.', enforcement: 'require-option', probability: 0,
  }] };
  const handlers = { 'choose-a': { matches: (_task: DecisionInput) => true, selectOption: (_task: DecisionInput) => 'a' } };
  const evaluation = evaluateDecisionRules(compileDecisionRuleSet(config, handlers), input);
  assert.equal(evaluation.requiredOptionId, undefined);
  assert.deepEqual(evaluation.guidance, [{ id: 'choose-a', priority: 100, instruction: 'Usually choose A.' }]);
  assert.throws(() => compileDecisionRuleSet(config, { 'choose-a': { matches: () => true } }), /INVALID_RULE_HANDLER/);
});

test('DR-v2.1: stable guidance preserves priority and only accepts guidance enforcement', () => {
  const config = { id: 'neutral', version: 3, rules: [
    { id: 'seat-language', priority: 80, instruction: 'Use seat numbers.', enforcement: 'guidance', placement: 'stable' },
  ] };
  const handlers = { 'seat-language': { matches: (_task: DecisionInput) => true } };
  const evaluation = evaluateDecisionRules(compileDecisionRuleSet(config, handlers), input);
  assert.deepEqual(evaluation.guidance, [{ id: 'seat-language', priority: 80, instruction: 'Use seat numbers.', placement: 'stable' }]);
  assert.throws(() => compileDecisionRuleSet({ ...config, rules: [{ ...config.rules[0], enforcement: 'require-option' }] }, handlers), /INVALID_RULE_SET/);
});
