import test from 'node:test';
import assert from 'node:assert/strict';
import type { DemoSnapshot } from '../../../apps/shared/werewolf.ts';
import { boardEvents, boardVoteCopy, summarizeVotes, type VoteData } from '../../../apps/web/src/werewolf/presentation.ts';

const sheriffVote: VoteData = {
  ballots: [
    { seat: 1, target: 8, kind: 'vote' },
    { seat: 3, target: 8, kind: 'vote' },
    { seat: 5, target: null, kind: 'abstain' },
  ],
  totals: [{ seat: 8, votes: 2 }, { seat: 10, votes: 0 }],
  winner: 8, tied: [], runoff: false, sheriff: null,
};

test('central board keeps settled sheriff and exile votes but removes every speech placeholder', () => {
  const events: DemoSnapshot['events'] = [
    { sequence: 1, day: 1, period: 'day', type: 'sheriff-candidates', data: { seats: [8, 10] } },
    { sequence: 2, day: 1, period: 'day', type: 'sheriff-speech', data: { seat: 8, text: '竞选' } },
    { sequence: 3, day: 1, period: 'day', type: 'sheriff-votes', data: sheriffVote as unknown as DemoSnapshot['events'][number]['data'] },
    { sequence: 4, day: 1, period: 'day', type: 'sheriff-result', data: { seat: 8 } },
    { sequence: 5, day: 1, period: 'day', type: 'night-deaths', data: { seats: [] } },
    { sequence: 6, day: 1, period: 'day', type: 'speech', data: { seat: 2, text: '发言' } },
    { sequence: 7, day: 1, period: 'day', type: 'speech', data: { seat: 3, text: '' } },
    { sequence: 8, day: 1, period: 'day', type: 'exile-votes', data: { ...sheriffVote, winner: 12 } },
    { sequence: 9, day: 1, period: 'day', type: 'last-words', data: { seat: 12, text: '遗言' } },
    { sequence: 10, day: 1, period: 'day', type: 'last-words', data: { seat: 8, text: '' } },
  ];
  assert.deepEqual(boardEvents(events).map(event => event.type),
    ['sheriff-candidates', 'sheriff-votes', 'sheriff-result', 'night-deaths', 'exile-votes']);
  assert.equal(boardEvents(events.filter(event => event.type !== 'sheriff-votes')).some(event => event.type === 'sheriff-votes'), false);
});

test('sheriff vote card distinguishes normal election, PK and badge loss from exile', () => {
  assert.deepEqual(boardVoteCopy('sheriff', sheriffVote, 1),
    { title: '第1天 · 警长竞选', outcome: '8号当选警长', ariaLabel: '第1天警长竞选票型' });
  assert.deepEqual(summarizeVotes(sheriffVote).find(row => row.target === 'abstain')?.voters, [5]);
  assert.deepEqual(boardVoteCopy('sheriff', { ...sheriffVote, winner: null, tied: [8, 10] }, 1),
    { title: '第1天 · 警长竞选', outcome: '8、10号平票，进入PK', ariaLabel: '第1天警长竞选票型' });
  assert.deepEqual(boardVoteCopy('sheriff', { ...sheriffVote, winner: null, tied: [8, 10], runoff: true }, 1),
    { title: '第1天 · 警长PK投票', outcome: '警徽流失', ariaLabel: '第1天警长PK票型' });
  assert.deepEqual(boardVoteCopy('exile', { ...sheriffVote, winner: 12 }, 1),
    { title: '第1天 · 放逐投票', outcome: '12号得票最高', ariaLabel: '第1天放逐票型' });
});
