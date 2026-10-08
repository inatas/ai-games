import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareJevSelect } from '../server/jev-comparison.ts';

const shadow = { event_type: 'model.shadow.jev.finished.v1', details: {
  choice: 'option-1', sampledSelected: 'option-0', confidence: 0.7,
  probabilities: { 'option-0': 0.2, 'option-1': 0.8 },
} };
const model = { event_type: 'model.call.finished.v1', details: {
  attempt: 2, rawText: '{"selected":"option-0"}',
} };

test('JS-09: compare committed model action with both JEV argmax and sampled action', () => {
  assert.deepEqual(compareJevSelect([shadow, model, { event_type: 'model.call.judged.v1', details: {
    attempt: 2, gameCommitted: true,
  } }]), {
    modelStatus: 'committed', modelSelected: 'option-0',
    jevChoice: 'option-1', jevSampledSelected: 'option-0',
    modelChoiceProbability: 0.2, matchesJevChoice: false, matchesJevSample: true,
  });
});

test('JS-09: rejected output and legacy shadow data never invent a model or sample choice', () => {
  assert.deepEqual(compareJevSelect([shadow, model, { event_type: 'model.call.judged.v1', details: {
    attempt: 2, gameCommitted: false,
  } }]), {
    modelStatus: 'not-committed', modelSelected: null,
    jevChoice: 'option-1', jevSampledSelected: 'option-0',
    modelChoiceProbability: null, matchesJevChoice: null, matchesJevSample: null,
  });
  const legacy = { ...shadow, details: { choice: 'option-1', confidence: 0.7,
    probabilities: { 'option-0': 0.2, 'option-1': 0.8 } } };
  assert.equal(compareJevSelect([legacy])?.jevSampledSelected, null);
  assert.equal(compareJevSelect([legacy])?.modelStatus, 'pending');
  assert.equal(compareJevSelect([model]), null);
});
