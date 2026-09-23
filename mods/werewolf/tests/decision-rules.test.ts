import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDecisionRules, type DecisionInput } from '@game-ai/turn-based';
import { werewolfDecisionRules } from '../src/decision-rules/index.ts';

const task = (role: string, round = 1): DecisionInput => ({
  actor: { roomId: 'sample-room', seat: 1, phaseInstance: 3 }, intent: 'SELECT', scene: 'nominations',
  options: [
    { id: 'option-0', value: { kind: 'nominate', run: false } },
    { id: 'option-1', value: { kind: 'nominate', run: true } },
  ],
  outputSchema: {},
  context: {
    rules: {}, game_state: { phase: { key: 'nominations', round } },
    self: { seat: 1, name: 'Player', role }, private_information: {}, public_history: {},
    current_action: { request_type: 'SELECT', scene: 'nominations', options: [], phaseInstance: 3 },
  },
});

test('WW-R01: seer first-day strategy refers to the legal run option', () => {
  assert.equal(werewolfDecisionRules.id, 'werewolf.robot-strategy');
  assert.equal(werewolfDecisionRules.version, 1);
  assert.equal(werewolfDecisionRules.rules[0]?.probability, 0.8);
  const evaluated = evaluateDecisionRules(werewolfDecisionRules, task('seer'));
  assert.ok(evaluated.requiredOptionId === undefined || evaluated.requiredOptionId === 'option-1');
  assert.deepEqual(evaluateDecisionRules(werewolfDecisionRules, task('wolf')).allowedOptionIds, ['option-0', 'option-1']);
  assert.deepEqual(evaluateDecisionRules(werewolfDecisionRules, task('seer', 2)).allowedOptionIds, ['option-0', 'option-1']);
});
