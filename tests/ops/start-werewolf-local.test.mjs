import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

test('local starter refuses a missing model credential file before starting Docker', () => {
  const missing = resolve('.local', 'nonexistent-model-credentials.env');
  const run = spawnSync('pwsh', ['-NoProfile', '-File', resolve('scripts', 'start-werewolf-local.ps1')], {
    cwd: resolve('.'), encoding: 'utf8',
    env: { ...process.env, AI_GAMES_MODEL_ENV_FILE: missing },
  });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /模型凭据文件不存在/);
  assert.doesNotMatch(run.stdout, /MODEL_API_KEY=/);
});
