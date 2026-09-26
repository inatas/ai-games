import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NetworkRetryGate } from '../src/model-network-retry.ts';

test('MR-05: retry concurrency is capped per profile and isolated across profiles', () => {
  const gate = new NetworkRetryGate({
    maxConcurrentRetries: 2, failureWindowMs: 10000, failureThreshold: 3, openMs: 15000,
  });
  const first = gate.acquire('a', true, 100);
  const second = gate.acquire('a', true, 100);
  assert.ok(first);
  assert.ok(second);
  assert.equal(gate.acquire('a', true, 100), null);
  const other = gate.acquire('b', true, 100);
  assert.ok(other);
  first();
  assert.ok(gate.acquire('a', true, 100));
  second();
  other();
});

test('MR-05: three failures open a circuit and one probe can restore it', () => {
  const gate = new NetworkRetryGate({
    maxConcurrentRetries: 2, failureWindowMs: 10000, failureThreshold: 3, openMs: 15000,
  });
  gate.networkFailure('a', 100);
  gate.networkFailure('a', 200);
  gate.networkFailure('a', 300);
  assert.equal(gate.acquire('a', false, 400), null);
  assert.ok(gate.acquire('b', false, 400));
  const probe = gate.acquire('a', false, 15300);
  assert.ok(probe);
  assert.equal(gate.acquire('a', false, 15300), null);
  gate.success('a');
  probe();
  assert.ok(gate.acquire('a', false, 15301));
});
