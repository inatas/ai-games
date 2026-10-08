import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jevDraw, sampleJevChoice } from '../server/jev-choice-selector.ts';

const ids = ['option-0', 'option-1'];
const answer = { choice: 'option-1', confidence: 0.5,
  probabilities: { 'option-0': 0.2, 'option-1': 0.8 } };

test('JS-07: confidence mixes the choice distribution before sampling, not selecting argmax', () => {
  assert.deepEqual(sampleJevChoice(ids, answer, 0.34), {
    normalizedProbabilities: { 'option-0': 0.2, 'option-1': 0.8 },
    samplingProbabilities: { 'option-0': 0.35, 'option-1': 0.65 },
    sampledSelected: 'option-0',
  });
  assert.equal(sampleJevChoice(ids, answer, 0.35)?.sampledSelected, 'option-1');
  assert.equal(sampleJevChoice(ids, { ...answer, confidence: 0 }, 0.49)?.sampledSelected, 'option-0');
  assert.equal(sampleJevChoice(ids, { ...answer, confidence: 1 }, 0.21)?.sampledSelected, 'option-1');
  assert.equal(sampleJevChoice(['only'], { choice: 'only', confidence: 0,
    probabilities: { only: 1 } }, 0.99)?.sampledSelected, 'only');
});

test('JS-06/08: malformed distributions fail closed and a request has one stable draw', () => {
  for (const bad of [
    { ...answer, probabilities: { 'option-0': 0.2 } },
    { ...answer, probabilities: { ...answer.probabilities, extra: 0.1 } },
    { ...answer, probabilities: { 'option-0': 0, 'option-1': 0 } },
    { ...answer, probabilities: { 'option-0': -0.2, 'option-1': 1.2 } },
    { ...answer, confidence: 1.01 },
    { ...answer, choice: 'missing' },
  ]) assert.equal(sampleJevChoice(ids, bad, 0.1), null);
  assert.equal(sampleJevChoice(ids, answer, -0.1), null);
  assert.equal(sampleJevChoice(ids, answer, 1), null);
  const requestId = '9f3a68e1-9b1d-4e8c-8991-15fd96678371';
  assert.equal(jevDraw(requestId), jevDraw(requestId));
  assert.ok(jevDraw(requestId) >= 0 && jevDraw(requestId) < 1);
});
