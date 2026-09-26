import { test } from 'node:test';
import assert from 'node:assert/strict';
import { werewolfDefinition } from '../src/definition.ts';
import { modelRoomSeedFromVersion } from '../server/werewolf-model-service.ts';

test('WW-W09: model rooms recognize the current definition version for start and recovery', () => {
  const version = werewolfDefinition({ seed: 10, sheriff: 'double' }).version;
  assert.equal(modelRoomSeedFromVersion(version), 10);
  assert.equal(modelRoomSeedFromVersion('4.10.double.unknown'), null);
  assert.equal(modelRoomSeedFromVersion('4.not-a-seed.double.rules3'), null);
});
