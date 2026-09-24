import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChatCompletionsAdapter } from '@game-ai/model';
import { loadModelProfiles, loadRobotUsers } from '../src/robot-users.ts';
import { buildRobotAdapters, profileForRobot } from '../src/robot-adapters.ts';

test('robot registry routes per user while model secrets stay in the server environment', () => {
  const users = loadRobotUsers();
  const env = { MODEL_BASE_URL: 'https://example.com/v1', MODEL_API_KEY: 'secret', MODEL_NAME: 'test-model' };
  const adapters = buildRobotAdapters(users, loadModelProfiles(), env);
  const model = users.find(user => user.control.kind === 'model')!;
  const script = users.find(user => user.control.kind === 'script')!;
  assert.ok(adapters[profileForRobot(model)] instanceof ChatCompletionsAdapter);
  assert.ok('decide' in adapters[profileForRobot(script)]);
  assert.notEqual(profileForRobot(script), profileForRobot(model));
  assert.ok('decide' in adapters[`script:${model.userId}`], 'a persisted pre-v5 script seat can resume');
  assert.throws(() => buildRobotAdapters(users, loadModelProfiles(), {}), /MODEL_ENV_MISSING/);
  assert.ok(!JSON.stringify(users).includes('secret'));
});
