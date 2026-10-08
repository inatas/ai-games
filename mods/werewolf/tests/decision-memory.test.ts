import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Json } from '@game-ai/core';
import { parseDecisionMemoryUpdate } from '../src/decision-memory.ts';

const facts: Json = {
  public_history: [{ sequence: 1 }],
  private_information: { events: [], team_history: [{ sequence: 2 }],
    team_plan: { planId: 'plan-1', version: 1, status: 'proposed' } },
};
const strategy = { tactic: '倒钩', claimedRole: 'villager', intendedReports: [],
  voteTarget: 7, nextStep: '根据公开票型表水', changeReason: '',
  teamPlanRef: { planId: 'plan-1', version: 1 } };
const evidence = { upserts: [{ topicKey: 'trust:7', judgment: '提议是队友意见，不是真实身份',
  basis: [{ visibility: 'private', sequence: 2 }] }], removeKeys: [] };

test('WW-SC01/03: evidence and strategy update independently; team events are authorized sources', () => {
  const result = parseDecisionMemoryUpdate({ selected: 'option-1', strategy_update: { set: strategy },
    personal_evidence_update: evidence }, facts, null) as { entries: Json[]; strategy: Json };
  assert.equal(result.entries.length, 1);
  assert.deepEqual(result.strategy, strategy);
  assert.deepEqual(parseDecisionMemoryUpdate({ strategy_update: 'invalid', personal_evidence_update: evidence }, facts, null),
    { entries: result.entries, strategy: null });
  assert.deepEqual(parseDecisionMemoryUpdate({ strategy_update: { set: strategy }, personal_evidence_update: 'invalid' }, facts, null),
    { entries: [], strategy });
});

test('WW-SC03/04: missing or invalid updates retain plan; withdrawal and reasoned adjustment replace it', () => {
  const previous = { entries: [], strategy };
  assert.equal(parseDecisionMemoryUpdate({ selected: 'option-1' }, facts, previous), null);
  assert.equal(parseDecisionMemoryUpdate({ strategy_update: { set: { ...strategy, tactic: '冲锋' } } }, facts, previous), null);
  const changed = { ...strategy, tactic: '冲锋', changeReason: '新的公开票型使倒钩不再合适' };
  assert.deepEqual(parseDecisionMemoryUpdate({ strategy_update: { set: changed } }, facts, previous), { entries: [], strategy: changed });
  assert.deepEqual(parseDecisionMemoryUpdate({ strategy_update: { set: null } }, facts, previous), { entries: [], strategy: null });
});

test('WW-SC03/J01: private plan cannot reference invisible versions or invent roles/seats', () => {
  for (const bad of [
    { ...strategy, teamPlanRef: { planId: 'plan-1', version: 2 } },
    { ...strategy, voteTarget: 13 },
    { ...strategy, claimedRole: 'sheriff' },
    { ...strategy, nextStep: 'x'.repeat(81) },
    { ...strategy, unexpected: true },
    { ...strategy, intendedReports: [{ night: 1, targetSeat: 7, alignment: 'good' }, { night: 1, targetSeat: 7, alignment: 'wolf' }] },
  ]) assert.equal(parseDecisionMemoryUpdate({ strategy_update: { set: bad } }, facts, null), null);
  const expired = structuredClone(facts) as Record<string, Json>;
  (expired.private_information as Record<string, Json>).team_plan = { planId: 'plan-1', version: 1, status: 'expired' };
  assert.equal(parseDecisionMemoryUpdate({ strategy_update: { set: strategy } }, expired, null), null);
  const withoutTeam = { ...strategy, teamPlanRef: null };
  assert.deepEqual(parseDecisionMemoryUpdate({ strategy_update: { set: withoutTeam } }, {}, null), { entries: [], strategy: withoutTeam });
});
