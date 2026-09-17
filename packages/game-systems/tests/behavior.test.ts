import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseBehavior, validateBehavior, type BehaviorDefinition } from '../src/index.ts';

const tree: BehaviorDefinition = { id: 'guard', npcId: 'guide', intervalMs: 1000, root: { type: 'selector', children: [
  { type: 'sequence', children: [{ type: 'condition', ruleId: 'danger', params: {} }, { type: 'action', actionId: 'move', params: { exitId: 'escape' } }] },
  { type: 'sequence', children: [{ type: 'action', actionId: 'move', params: { exitId: 'east' } }, { type: 'action', actionId: 'move', params: { exitId: 'west' } }] },
] } };

test('BT-01/03: priority, sequence progress, failures and bounded trees', () => {
  validateBehavior(tree, ['move'], ['danger']);
  const calm = chooseBehavior(tree, () => false, {});
  assert.equal(calm.action?.params.exitId, 'east');
  const next = chooseBehavior(tree, () => false, { [calm.path!]: 'success' });
  assert.equal(next.action?.params.exitId, 'west');
  const urgent = chooseBehavior(tree, () => true, { [calm.path!]: 'success' });
  assert.equal(urgent.action?.params.exitId, 'escape');
  assert.deepEqual(urgent.completed, {}, 'switching priority discards old sequence progress');
  assert.equal(chooseBehavior(tree, () => false, { [calm.path!]: 'failure' }).status, 'failure');
  assert.throws(() => validateBehavior({ ...tree, intervalMs: 0 }, ['move'], ['danger']), /INVALID_BEHAVIOR/);
  assert.throws(() => validateBehavior(tree, [], ['danger']), /UNKNOWN_ACTION/);
  assert.throws(() => validateBehavior(tree, ['move'], []), /UNKNOWN_RULE/);
  const cyclic: any = { type: 'sequence', children: [] }; cyclic.children.push(cyclic);
  assert.throws(() => validateBehavior({ ...tree, root: cyclic }, ['move'], ['danger']), /INVALID_BEHAVIOR/);
});
