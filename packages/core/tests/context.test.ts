import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContext, conservativeCounter } from '@game-ai/core';

const emptyContext = { facts: {}, instructions: '', input: {}, schema: {}, required: [], optional: [] };

test('F-19: optional memory is ranked, deduplicated and budgeted', () => {
  const records = [1, 2, 3].map(n => ({ id: `E${n}`, kind: 'event' as const, payload: { n }, importance: n, sequence: n, sourceIds: [], visibility: 'public' as const }));
  const counter = (messages: any[]) => 7000 + JSON.parse(messages.find(m => m.content.startsWith('HISTORY:')).content.slice(8)).length * 500;
  const result = buildContext({ facts: {}, instructions: 'test', input: {}, schema: {}, required: [], optional: [...records, records[1]], counter, inputBudget: 8000 });
  assert.deepEqual(result.contextIds, ['E3', 'E2']);
  assert.equal(result.inputTokens, 8000);
});

test('F-20: mandatory context is never silently truncated', () => {
  assert.throws(() => buildContext({ ...emptyContext, counter: () => 8001, inputBudget: 8000 }), /CONTEXT_TOO_LARGE/);
});

test('CB-01/02: default budget keeps required content up to 100,000 UTF-8 bytes and rejects larger input', () => {
  const within = buildContext({ ...emptyContext, facts: { payload: 'x'.repeat(90_000) } });
  assert.equal(within.inputBudget, 100_000);
  assert.equal(within.messages.find(message => message.content.startsWith('CURRENT_FACTS:'))?.content.includes('x'.repeat(90_000)), true);
  assert.throws(() => buildContext({ ...emptyContext, facts: { payload: 'x'.repeat(100_000) } }), /CONTEXT_TOO_LARGE/);
});

test('CB-03/04: UTF-8 bytes, explicit window and output reserve retain their boundaries', () => {
  const chinese = buildContext({ ...emptyContext, facts: { payload: '中'.repeat(30_000) } });
  assert.equal(chinese.inputTokens, conservativeCounter(chinese.messages));
  assert.ok(chinese.inputTokens > 90_000 && chinese.inputTokens <= 100_000);
  assert.throws(() => buildContext({ ...emptyContext, facts: { payload: '中'.repeat(34_000) } }), /CONTEXT_TOO_LARGE/);
  const constrained = buildContext({ ...emptyContext, window: 5_000, outputBudget: 1_000 });
  assert.equal(constrained.inputBudget, 4_000);
  assert.throws(() => buildContext({ ...emptyContext, facts: { payload: 'x'.repeat(4_000) }, window: 5_000, outputBudget: 1_000 }), /CONTEXT_TOO_LARGE/);
});

