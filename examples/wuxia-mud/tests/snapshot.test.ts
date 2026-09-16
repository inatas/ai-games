import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptSnapshot } from '../../../apps/web/src/snapshot.ts';

test('WM-21: older and retired-scope responses cannot overwrite the screen', () => {
  const current = { id: 'new', memoryVersion: 9 };
  assert.equal(acceptSnapshot('new', current, { id: 'new', memoryVersion: 8 }), current);
  assert.equal(acceptSnapshot('new', current, { id: 'old', memoryVersion: 100 }), current);
  assert.equal(acceptSnapshot('new', null, { id: 'old', memoryVersion: 100 }), null);
  const next = { id: 'new', memoryVersion: 10 };
  assert.equal(acceptSnapshot('new', current, next), next);
});
