import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Message } from '@game-ai/core';
import { buildJevSelectRequest } from '../server/jev-shadow.ts';

const messages: Message[] = [
  { role: 'system', content: '固定协议' },
  { role: 'user', content: 'CURRENT_FACTS:' + JSON.stringify({ current_action: {
    request_type: 'SELECT', options: [
      { id: 'option-0', value: { kind: 'pass' } },
      { id: 'option-1', value: { kind: 'vote', target: 5 } },
    ],
  } }) },
];

test('JS-01: JEV choice uses the exact authorized model messages and legal options', () => {
  const request = buildJevSelectRequest({
    messages,
    outputSchema: { properties: { selected: { enum: ['option-0', 'option-1'] } } },
  });
  assert.ok(request);
  assert.deepEqual(request.state.messages, messages);
  assert.deepEqual(Object.keys(request.questions.selected.criteria), ['option-0', 'option-1']);
  assert.match(request.questions.selected.criteria['option-1']!, /target.*5/);
});

test('JS-02: speech and mismatched option sets never form a JEV request', () => {
  assert.equal(buildJevSelectRequest({ messages, outputSchema: { properties: { speech: { type: 'string' } } } }), null);
  assert.equal(buildJevSelectRequest({ messages, outputSchema: { properties: { selected: { enum: ['option-0', 'missing'] } } } }), null);
  const speechMessages: Message[] = [messages[0]!, { role: 'user', content: 'CURRENT_FACTS:' + JSON.stringify({ current_action: {
    request_type: 'SPEECH', options: [{ id: 'option-0', value: { kind: 'pass' } }],
  } }) }];
  assert.equal(buildJevSelectRequest({ messages: speechMessages,
    outputSchema: { properties: { selected: { enum: ['option-0'] } } } }), null);
});
