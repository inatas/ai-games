import test from 'node:test';
import assert from 'node:assert/strict';
import type { DemoSnapshot } from '../shared/werewolf.ts';
import { buildHistoryTimeline, filterHistoryTimeline } from '../web/history-timeline.ts';

function snapshot(status: DemoSnapshot['status']): DemoSnapshot {
  const publicEvents: DemoSnapshot['events'] = [
    { sequence: 1, day: 1, period: 'day', type: 'sheriff-speech', data: { seat: 2, text: '我来竞选。', runoff: false } },
    { sequence: 2, day: 1, period: 'day', type: 'sheriff-votes', data: { ballots: [{ seat: 1, target: 8, kind: 'vote' }], totals: [{ seat: 8, votes: 1 }], winner: 8, tied: [], runoff: false, sheriff: null } },
    { sequence: 3, day: 1, period: 'day', type: 'sheriff-result', data: { seat: 8 } },
    { sequence: 4, day: 1, period: 'day', type: 'night-deaths', data: { seats: [] } },
    { sequence: 5, day: 1, period: 'day', type: 'unknown-internal', data: {} },
  ];
  const replay: NonNullable<DemoSnapshot['replay']> = [
    { day: 1, period: 'night', events: [
      { sequence: 1, day: 1, period: 'night', type: 'wolf-knife', data: { night: 1, target: 12 } },
      { sequence: 2, day: 1, period: 'night', type: 'wolf-choices', data: [{ seat: 12, target: 2 }, { seat: 8, target: 10 }, { seat: 2, target: 12 }, { seat: 7, target: 12 }] },
      { sequence: 3, day: 1, period: 'night', type: 'inspection', data: { target: 5, alignment: 'good' } },
      { sequence: 4, day: 1, period: 'night', type: 'medicine', data: { seat: 6, action: { kind: 'save' } } },
    ] },
    { day: 1, period: 'day', events: publicEvents.map(event => ({ ...event, sequence: event.sequence + 4 })) },
  ];
  return {
    id: 'history', revision: 1, status, day: 1, period: 'day', phaseLabel: '上警发言',
    speakerSeat: null, nightSegment: null, timing: { remainingMs: 90_000 }, speeches: [],
    actor: null, progress: null, sheriff: 8, players: [], events: publicEvents, result: null,
    replay, roles: [{ seat: 2, role: 'wolf' }],
  };
}

test('running history uses only public events even if a stale snapshot carries replay fields', () => {
  const items = buildHistoryTimeline(snapshot('running'));
  assert.deepEqual(items.map(item => item.kind), ['speech', 'vote', 'announcement']);
  assert.equal(JSON.stringify(items).includes('wolf-choices'), false);
  assert.equal(JSON.stringify(items).includes('inspection'), false);
  assert.equal(JSON.stringify(items).includes('unknown-internal'), false);
  assert.equal(items[1].kind, 'vote');
  assert.equal(items[1].day, 1);
});

test('finished history inserts wolf choices, final knife, medicine and inspection before first-day speech', () => {
  const items = buildHistoryTimeline(snapshot('finished'));
  assert.deepEqual(items.slice(0, 4).map(item => item.kind), ['wolf-choices', 'wolf-knife', 'medicine', 'inspection']);
  assert.deepEqual(items.slice(0, 4).map(item => item.period), ['night', 'night', 'night', 'night']);
  assert.equal(items[2].kind === 'medicine' && items[2].knifeTarget, 12);
  assert.equal(items.filter(item => item.kind === 'speech').length, 1);
  assert.equal(items.filter(item => item.kind === 'vote').length, 1);
  assert.equal(JSON.stringify(items).includes('unknown-internal'), false);
  assert.equal(filterHistoryTimeline(items, 1).length, items.length);
  assert.equal(filterHistoryTimeline(items, 2).length, 0);
  assert.deepEqual(filterHistoryTimeline(items, 'all'), items);
});

test('daybreak announcement follows the night, and exile result is shown once with its vote', () => {
  const game = snapshot('finished');
  game.replay![0].events.push({ sequence: 5, day: 1, period: 'night', type: 'night-deaths', data: { seats: [3] } });
  game.replay![1].events.push({ sequence: 10, day: 1, period: 'day', type: 'exile-votes', data: { ballots: [], totals: [], winner: 7, tied: [], sheriff: null } });
  game.replay![1].events.push({ sequence: 11, day: 1, period: 'day', type: 'exiled', data: { seat: 7 } });
  const items = buildHistoryTimeline(game);
  assert.equal(items.filter(item => item.kind === 'announcement' && item.text.includes('7号')).length, 0);
  assert.equal(items.find(item => item.kind === 'announcement' && item.text.includes('3号'))?.period, 'day');
});
