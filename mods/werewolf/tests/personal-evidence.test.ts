import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, occupySeat } from '@game-ai/turn-based';
import { parsePersonalEvidenceUpdate } from '../src/personal-evidence.ts';
import { werewolfDefinition } from '../src/definition.ts';
import { prepareWerewolfDecision } from '../src/decision-input.ts';

const facts = {
  public_history: [{ sequence: 18, type: 'speech', record_kind: 'player-statement' }],
  private_information: { events: [{ sequence: 19, type: 'inspection', result: { status: 'settled' } }] },
};
const update = {
  upserts: [{ topicKey: 'role:3:seer', judgment: '暂时更相信3号',
    basis: [{ visibility: 'public', sequence: 18 }] }], removeKeys: [],
};

test('WW-PM01/04: personal judgment is a bounded, source-linked patch', () => {
  const first = parsePersonalEvidenceUpdate({ personal_evidence_update: update }, facts, null);
  assert.deepEqual(first, { entries: update.upserts });
  const revised = parsePersonalEvidenceUpdate({ personal_evidence_update: {
    upserts: [{ ...update.upserts[0], judgment: '对跳后存疑' }], removeKeys: [],
  } }, facts, first);
  assert.deepEqual(revised, { entries: [{ ...update.upserts[0], judgment: '对跳后存疑' }] });
  assert.deepEqual(parsePersonalEvidenceUpdate({ personal_evidence_update: {
    upserts: [], removeKeys: ['role:3:seer'],
  } }, facts, revised), { entries: [] });
});

test('WW-PM02/03: unavailable sources and malformed updates are ignored', () => {
  for (const raw of [null, 'bad', { upserts: [{ ...update.upserts[0], basis: [{ visibility: 'private', sequence: 18 }] }], removeKeys: [] },
    { upserts: [{ ...update.upserts[0], basis: [{ visibility: 'public', sequence: 19 }] }], removeKeys: [] },
    { upserts: [update.upserts[0], update.upserts[0]], removeKeys: [] }]) {
    assert.equal(parsePersonalEvidenceUpdate({ personal_evidence_update: raw }, facts, null), null);
  }
  assert.equal(parsePersonalEvidenceUpdate({}, facts, null), null);
});

test('WW-PM01: the optional sidecar is available in both action schemas without changing six input sections', () => {
  const definition = werewolfDefinition({ seed: 42, sheriff: 'double' });
  let room = createRoom('personal-schema', 'personal-schema', definition);
  for (let seat = 1; seat <= 12; seat++) room = occupySeat(room, {
    seat, name: `${seat}号`, modelProfile: 'model', scopeId: `scope-${seat}`, interruptScopeId: `interrupt-${seat}`,
  }, definition);
  const select = prepareWerewolfDecision(room, 10, definition);
  assert.equal(select.intent, 'SELECT');
  assert.deepEqual((select.outputSchema as { required: string[] }).required, ['selected']);
  assert.ok('personal_evidence_update' in (select.outputSchema as { properties: object }).properties);
  room.phase = { ...room.phase!, key: 'speech', actors: [10], schema: {
    type: 'object', properties: { text: { type: 'string' } },
  } };
  const speech = prepareWerewolfDecision(room, 10, definition);
  assert.equal(speech.intent, 'SPEECH');
  assert.deepEqual((speech.outputSchema as { required: string[] }).required, ['speech']);
  assert.ok('personal_evidence_update' in (speech.outputSchema as { properties: object }).properties);
  assert.deepEqual(Object.keys(speech.context), Object.keys(select.context));
});
