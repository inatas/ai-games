import type { DemoSnapshot } from '../../../apps/shared/werewolf.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicSeatState } from '../../../apps/web/src/werewolf/seat-state.ts';

test('AV-03/04: avatar deaths follow announced public events, never private medicine', () => {
  const events: DemoSnapshot['events'] = [{ type: 'night-deaths', data: { seats: [3] } }, { type: 'medicine', data: { seat: 5, action: { kind: 'poison', target: 3 } } }];
  assert.equal(publicSeatState(3, true, events, false).death, null);
  assert.equal(publicSeatState(3, false, events, false).death, 'night');
  assert.equal(publicSeatState(4, false, [{ type: 'hunter-shot', data: { seat: 2, target: 4 } }], false).death, 'shot');
  assert.equal(publicSeatState(4, false, [{ type: 'exiled', data: { seat: 4 } }], false).death, 'exile');
});

test('AV-05/09: nomination clears on withdrawal/end; explosion is publicly known', () => {
  const events: DemoSnapshot['events'] = [{ type: 'sheriff-candidates', data: { seats: [1, 2] } }, { type: 'sheriff-withdrawal', data: { seat: 2 } }];
  assert.equal(publicSeatState(1, true, events, true).nominated, true);
  assert.equal(publicSeatState(2, true, events, true).nominated, false);
  assert.equal(publicSeatState(1, true, events, false).nominated, false);
  assert.equal(publicSeatState(1, false, [{ type: 'wolf-explosion', data: { seat: 1 } }], false).death, 'explode');
});

