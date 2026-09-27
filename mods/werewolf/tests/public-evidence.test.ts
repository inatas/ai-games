import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, occupySeat } from '@game-ai/turn-based';
import { werewolfDefinition } from '../src/definition.ts';
import { buildPublicHistory } from '../src/public-evidence.ts';
import { prepareWerewolfDecision } from '../src/decision-input.ts';

function room() {
  const definition = werewolfDefinition({ seed: 42, sheriff: 'double' });
  let result = createRoom('evidence-room', 'evidence-run', definition);
  for (let seat = 1; seat <= 12; seat++) result = occupySeat(result, {
    seat, name: `${seat}号`, modelProfile: 'script-random',
    scopeId: `scope-${seat}`, interruptScopeId: `interrupt-${seat}`,
  }, definition);
  return { result, definition };
}

type Evidence = { record_kind: string; kind?: string; status?: string; actorSeat?: number;
  otherActorSeat?: number; targetSeat?: number; reportedAlignment?: string;
  sourceSequences?: number[]; quote?: string; windowId?: string };

test('WW-E02/E04: explicit first-person claims retain sources without becoming verified facts', () => {
  const { result } = room();
  result.phaseHistory = [{ instance: 1, key: 'election-speech', round: 1 }];
  result.events = [
    { sequence: 1, phaseInstance: 1, type: 'sheriff-speech', audience: 'public', data: {
      seat: 3, text: '我是预言家，7号是我查验的金水。', runoff: false,
    } },
    { sequence: 2, phaseInstance: 1, type: 'sheriff-speech', audience: 'public', data: {
      seat: 8, text: '我是女巫，昨夜我救了2号。', runoff: false,
    } },
  ];
  const history = buildPublicHistory(result) as Evidence[];
  assert.deepEqual(history.filter(item => item.record_kind === 'derived-public-evidence').map(item => [
    item.kind, item.status, item.actorSeat, item.targetSeat, item.reportedAlignment, item.sourceSequences,
  ]), [
    ['role-claim', 'claim', 3, undefined, undefined, [1]],
    ['inspection-claim', 'claim', 3, 7, 'good', [1]],
    ['role-claim', 'claim', 8, undefined, undefined, [2]],
    ['save-claim', 'claim', 8, 2, undefined, [2]],
  ]);
  assert.equal(history.filter(item => item.record_kind === 'player-statement').length, 2);
  assert.equal(JSON.stringify(history).includes('"verified"'), false);
});

test('WW-E02: negation, quotes, hypotheticals and bare evaluations stay raw', () => {
  const { result } = room();
  result.phaseHistory = [{ instance: 1, key: 'speech', round: 1 }];
  const texts = ['我不是预言家。', '3号说“我是女巫”。', '如果我是预言家，7号就是金水。',
    '7号金水。', '我查验7号是好人，但7号也是狼人。'];
  result.events = texts.map((text, index) => ({ sequence: index + 1, phaseInstance: 1,
    type: 'speech', audience: 'public' as const, data: { seat: index + 1, text } }));
  const history = buildPublicHistory(result) as Evidence[];
  assert.equal(history.filter(item => item.record_kind === 'derived-public-evidence').length, 0);
  assert.equal(history.filter(item => item.record_kind === 'player-statement').length, texts.length);
});

test('WW-E03: counterclaim appears after the second claim; absence needs a completed clean window', () => {
  const { result } = room();
  result.phaseHistory = [
    { instance: 1, key: 'election-speech', round: 1 },
    { instance: 2, key: 'election-speech', round: 1 },
  ];
  result.phase = { ...result.phase!, key: 'election-speech' };
  result.phaseInstance = 2;
  result.events = [{ sequence: 1, phaseInstance: 1, type: 'sheriff-speech', audience: 'public',
    data: { seat: 3, text: '我是预言家。', runoff: false } }];
  assert.equal((buildPublicHistory(result) as Evidence[]).some(item => item.kind === 'no-extracted-counterclaim'), false);
  result.events.push({ sequence: 2, phaseInstance: 2, type: 'sheriff-speech', audience: 'public',
    data: { seat: 9, text: '我也是预言家。', runoff: false } });
  const contested = buildPublicHistory(result) as Evidence[];
  assert.deepEqual(contested.find(item => item.kind === 'counterclaim')?.sourceSequences, [1, 2]);
  assert.equal(contested.find(item => item.kind === 'counterclaim')?.otherActorSeat, 3);
  result.events.pop();
  result.phaseInstance = 3;
  result.phase = { ...result.phase!, key: 'election-withdrawal' };
  result.phaseHistory.push({ instance: 3, key: 'election-withdrawal', round: 1 });
  const closed = buildPublicHistory(result) as Evidence[];
  assert.equal(closed.find(item => item.kind === 'no-extracted-counterclaim')?.actorSeat, 3);
  assert.deepEqual(buildPublicHistory(structuredClone(result)), closed);
  result.events.push({ sequence: 4, phaseInstance: 3, type: 'sheriff-withdrawal', audience: 'public',
    data: { seat: 11 } });
  assert.deepEqual((buildPublicHistory(result) as Evidence[]).slice(0, closed.length), closed);
  result.events.pop();
  result.events.push({ sequence: 3, phaseInstance: 2, type: 'sheriff-speech', audience: 'public',
    data: { seat: 9, text: '我不是预言家。', runoff: false } });
  assert.equal((buildPublicHistory(result) as Evidence[]).some(item => item.kind === 'no-extracted-counterclaim'), false);
  result.events.pop();
  result.events.push({ sequence: 3, phaseInstance: 2, type: 'wolf-explosion', audience: 'public',
    data: { seat: 9 } });
  assert.equal((buildPublicHistory(result) as Evidence[]).some(item => item.kind === 'no-extracted-counterclaim'), false);
  result.events.pop();
  result.events[0] = { sequence: 1, phaseInstance: 1, type: 'sheriff-speech', audience: 'public',
    data: { seat: 3, text: '我是预言家，但我不是预言家。', runoff: false } };
  assert.equal((buildPublicHistory(result) as Evidence[]).some(item => item.kind === 'no-extracted-counterclaim'), false);
});

test('WW-E05: ballots appear only after public tally and every seat gets identical public history', () => {
  const { result, definition } = room();
  result.phase = { ...result.phase!, key: 'speech', actors: [1, 2],
    schema: { type: 'object', properties: { text: { type: 'string' } } } };
  result.phaseHistory = [{ instance: 1, key: 'speech', round: 1 }];
  result.events = [
    { sequence: 1, phaseInstance: 1, type: 'speech', audience: 'public',
      data: { seat: 3, text: '我是预言家。' } },
    { sequence: 2, phaseInstance: 1, type: 'sheriff-ballot', audience: 'after-game',
      data: { seat: 1, target: 3 } },
    { sequence: 3, phaseInstance: 1, type: 'wolf-knife', audience: [1],
      data: { night: 1, target: 12 } },
  ];
  const before = prepareWerewolfDecision(result, 1, definition).context.public_history;
  assert.deepEqual(before, prepareWerewolfDecision(result, 2, definition).context.public_history);
  assert.equal(JSON.stringify(before).includes('sheriff-ballot'), false);
  assert.equal(JSON.stringify(before).includes('wolf-knife'), false);
  result.events.push({ sequence: 4, phaseInstance: 1, type: 'sheriff-votes', audience: 'public', data: {
    ballots: [{ seat: 1, target: 3, kind: 'vote' }, { seat: 2, target: null, kind: 'abstain' }],
    totals: [{ seat: 3, votes: 1 }], winner: 3, tied: [], runoff: false,
  } });
  const after = prepareWerewolfDecision(result, 1, definition).context.public_history as
    { type?: string; data?: { ballots?: unknown[] } }[];
  assert.deepEqual(after.find(item => item.type === 'sheriff-votes')?.data?.ballots,
    [{ seat: 1, target: 3, kind: 'vote' }, { seat: 2, target: null, kind: 'abstain' }]);
  assert.equal(after.filter(item => item.type === 'sheriff-votes').length, 1);
});
