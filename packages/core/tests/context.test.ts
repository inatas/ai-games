import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContext } from '@game-ai/core';

test('F-19: optional memory is ranked, deduplicated and budgeted', () => {
  const records = [1, 2, 3].map(n => ({ id: `E${n}`, kind: 'event' as const, payload: { n }, importance: n, sequence: n, sourceIds: [], visibility: 'public' as const }));
  const counter = (messages: any[]) => 7000 + JSON.parse(messages.find(m => m.content.startsWith('HISTORY:')).content.slice(8)).length * 500;
  const result = buildContext({ facts: {}, instructions: 'test', input: {}, schema: {}, required: [], optional: [...records, records[1]], counter });
  assert.deepEqual(result.contextIds, ['E3', 'E2']);
  assert.equal(result.inputTokens, 8000);
});

test('F-20: mandatory context is never silently truncated', () => {
  assert.throws(() => buildContext({ facts: {}, instructions: '', input: {}, schema: {}, required: [], optional: [], counter: () => 8001 }), /CONTEXT_TOO_LARGE/);
});

