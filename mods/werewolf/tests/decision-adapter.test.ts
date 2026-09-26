import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DecisionInput } from '@game-ai/turn-based';
import { ScriptDecisionAdapter, decodeWerewolfDecision } from '../src/decision-adapter.ts';

const select: DecisionInput = {
  intent: 'SELECT', scene: 'vote', actor: { roomId: 'r', seat: 2, phaseInstance: 3 },
  context: {
    rules: {}, game_state: {}, self: { seat: 2, name: '2号', role: 'villager' },
    private_information: {}, public_history: [],
    current_action: { request_type: 'SELECT', scene: 'vote', options: [], phaseInstance: 3 },
  },
  options: [{ id: 'abstain', value: { kind: 'vote', target: null } }, { id: 'seat-4', value: { kind: 'vote', target: 4 } }],
  outputSchema: {},
};

test('script adapter returns the same speech/selected proposal envelope used by model seats', async () => {
  const adapter = new ScriptDecisionAdapter({ speech: '我是狼人杀玩家', seed: 42 });
  const signal = new AbortController().signal;
  const choice = await adapter.decide(select, signal);
  assert.equal(choice.kind, 'proposal');
  assert.ok(['abstain', 'seat-4'].includes((choice as { value: { selected: string } }).value.selected));
  assert.deepEqual(decodeWerewolfDecision(select, choice), select.options.find(option => option.id === (choice as { value: { selected: string } }).value.selected)?.value);
  const speak = { ...select, intent: 'SPEAK' as const, scene: 'last-words', options: [] };
  const utterance = await adapter.decide(speak, signal);
  assert.deepEqual(utterance, { kind: 'proposal', value: { speech: '我是狼人杀玩家' } });
  assert.deepEqual(decodeWerewolfDecision(speak, utterance), { kind: 'last-words', text: '我是狼人杀玩家' });
  assert.deepEqual(decodeWerewolfDecision(select, { kind: 'proposal', value: { selected: 'invented' } }), null);
  assert.deepEqual(decodeWerewolfDecision(speak, { kind: 'proposal', value: { speech: '字'.repeat(201) } }), null);
});
