import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContext } from '@game-ai/core';

test('W: worldview is mandatory, ordered and never trimmed to fit history', () => {
  const args = { facts: {}, instructions: 'host', input: {}, schema: {}, required: [], optional: [], worldview: { worldId: 'neutral', version: '1', content: 'Peaceful world', digest: 'test' } };
  const result = buildContext(args);
  assert.ok(result.messages[1].content.includes('WORLDVIEW:'));
  assert.ok(result.messages[1].content.includes('Peaceful world'));
  assert.throws(() => buildContext({ ...args, inputBudget: 100 }), /CONTEXT_TOO_LARGE/);
  const base = result.inputTokens;
  const crowded = buildContext({ ...args, inputBudget: base + 5, optional: [{ id: 'large', kind: 'event', payload: 'history'.repeat(1000), sourceIds: [], visibility: 'public', importance: 3, sequence: 1 }] });
  assert.ok(crowded.messages[1].content.includes('Peaceful world'));
  assert.deepEqual(crowded.contextIds, []);
});
