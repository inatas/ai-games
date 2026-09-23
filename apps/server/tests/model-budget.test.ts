import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ModelRequest } from '@game-ai/core';
import { BudgetedModelAdapter } from '../src/model-budget.ts';

const request: ModelRequest = {
  requestId: 'budget-1', attempt: 1, messages: [{ role: 'user', content: '选择一名玩家' }],
  outputSchema: { type: 'object' }, maxOutputTokens: 100,
};

test('worst-case reservation blocks a second paid call before reaching provider', async () => {
  let spent = 0;
  let calls = 0;
  const adapter = new BudgetedModelAdapter({
    async generate() { calls++; return { rawText: '{}', model: 'test', usage: null }; },
  }, { inputCnyPerMillion: 2000, outputCnyPerMillion: 2000 }, async micro => {
    if (spent + micro > 10_000_000) throw new Error('MODEL_BUDGET_EXCEEDED');
    spent += micro;
  });
  await adapter.generate(request, new AbortController().signal);
  await assert.rejects(() => adapter.generate(request, new AbortController().signal), /MODEL_BUDGET_EXCEEDED/);
  assert.equal(calls, 1);
});
