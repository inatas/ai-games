import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildJevSelectRequest } from '../server/jev-shadow.ts';

test('WW-TC07: team consent SELECT has no JEV side call; ordinary knife still maps', () => {
  const request = (scene: string) => ({
    messages: [{ role: 'user' as const, content: 'CURRENT_FACTS:' + JSON.stringify({ current_action: {
      request_type: 'SELECT', scene, options: [{ id: 'option-0', value: { kind: 'knife', target: null } }],
    } }) }], outputSchema: { properties: { selected: { enum: ['option-0'] } } },
  });
  assert.equal(buildJevSelectRequest(request('wolf-team-self-knife-consent')), null);
  assert.notEqual(buildJevSelectRequest(request('wolves')), null);
});
