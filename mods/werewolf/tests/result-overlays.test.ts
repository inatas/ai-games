import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoRooms } from '../src/demo.ts';
import { nextPresentation } from '../web/presentation.ts';
import type { DemoSnapshot } from '../shared/werewolf.ts';

const base = { ...new DemoRooms({ now: () => 0 }).create(42, 'fixed'), revision: 1, period: 'day' as const };
function events(entries: [string, object][]): DemoSnapshot['events'] {
  return entries.map(([type, data], i) => ({ type, data: data as DemoSnapshot['events'][number]['data'], sequence: i + 1, day: 1, period: 'day' }));
}
test('result overlays map all public outcomes, keep every death and show only the shot target', () => {
  const game = { ...base, revision: 2, events: events([
    ['sheriff-result', { seat: 9 }], ['exiled', { seat: 4 }], ['night-deaths', { seats: [3, 8, 11] }],
    ['hunter-shot', { seat: 5, target: 7 }], ['wolf-explosion', { seat: 6 }], ['idiot-revealed', { seat: 10 }],
    ['badge-transfer', { seat: 9, target: 2 }], ['badge-transfer', { seat: 2, target: null }],
  ]) };
  const result = nextPresentation(nextPresentation(null, base, false).cursor, game, false);
  assert.deepEqual(result.items.map(i => [i.result, i.seats]), [
    ['sheriff', [9]], ['exile', [4]], ['night-deaths', [3, 8, 11]], ['shot', [7]],
    ['explosion', [6]], ['idiot', [10]], ['badge-transfer', [9, 2]], ['badge-lost', []],
  ]);
  assert.equal(nextPresentation(result.cursor, game, false).items.length, 0);
  assert.equal(nextPresentation(null, game, false).items.length, 0);
});
test('empty outcomes do not invent targets or declare PK/highest-vote players dead', () => {
  const game = { ...base, revision: 2, events: events([
    ['sheriff-result', { seat: null }], ['night-deaths', { seats: [] }], ['hunter-shot', { seat: 5, target: null }],
    ['exile-votes', { winner: null, tied: [3, 4] }], ['exile-votes', { winner: 10, tied: [] }],
    ['idiot-revealed', { seat: 10 }], ['exile-votes', { winner: null, tied: [] }],
  ]) };
  const result = nextPresentation(nextPresentation(null, base, false).cursor, game, false);
  assert.deepEqual(result.items.map(i => [i.result, i.seats]), [
    ['no-sheriff', []], ['peaceful', []], ['no-shot', [5]], ['idiot', [10]], ['no-exile', []],
  ]);
});
test('results survive hidden panels, precede night, and the final shot survives match completion', () => {
  const cursor = nextPresentation(null, base, false).cursor;
  const game = { ...base, revision: 2, period: 'night' as const, events: events([['exiled', { seat: 4 }]]) };
  const hidden = nextPresentation(cursor, game, true);
  assert.deepEqual(nextPresentation(hidden.cursor, game, false).items.map(i => i.result), ['exile']);
  assert.deepEqual(nextPresentation(cursor, game, false).items.map(i => i.result ?? i.kind), ['exile', 'night']);
  const finished = { ...base, revision: 2, status: 'finished' as const, events: events([['hunter-shot', { seat: 5, target: 7 }]]) };
  assert.deepEqual(nextPresentation(cursor, finished, false).items.map(i => [i.result, i.seats]), [['shot', [7]]]);
  assert.equal(nextPresentation(null, finished, false).items.length, 0);
});

test('a result causing the next night is retained across the day increment; old hidden results are not replayed', () => {
  const cursor = nextPresentation(null, base, false).cursor;
  const game = { ...base, day: 2, revision: 2, period: 'night' as const, events: events([['exiled', { seat: 4 }]]) };
  assert.deepEqual(nextPresentation(cursor, game, false).items.map(i => i.result ?? i.kind), ['exile', 'night']);
  const hidden = nextPresentation(cursor, { ...game, day: 1 }, true);
  assert.deepEqual(nextPresentation(hidden.cursor, game, false).items.filter(i => i.result), []);
});

test('one election loss does not also create a duplicate badge-loss card', () => {
  const game = { ...base, revision: 2, events: events([
    ['wolf-explosion', { seat: 6 }], ['sheriff-result', { seat: null }], ['badge-transfer', { seat: 6, target: null }],
  ]) };
  assert.deepEqual(nextPresentation(nextPresentation(null, base, false).cursor, game, false).items.map(i => i.result), ['explosion', 'no-sheriff']);
});
