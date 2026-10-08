import test from 'node:test';
import assert from 'node:assert/strict';
import { presentationMotion, type PresentationItem } from '../web/presentation.ts';

test('all result populations share the two-stage reveal and exit timeline', () => {
  for (const seats of [[], [1], [1,2,3,4,5,6]]) {
    const item: PresentationItem = { id:'test', kind:'result', result:'night-deaths', day:1, seats };
    assert.equal(presentationMotion(item, 1199).people, false);
    assert.equal(presentationMotion(item, 1200).people, true);
    assert.equal(presentationMotion(item, 3549).exiting, false);
    assert.equal(presentationMotion(item, 3550).exiting, true);
    assert.equal(presentationMotion(item, 3899).done, false);
    assert.equal(presentationMotion(item, 3900).done, true);
    assert.equal(presentationMotion(item, 0, true).people, true);
    assert.equal(presentationMotion(item, 1999, true).done, false);
    assert.equal(presentationMotion(item, 2000, true).done, true);
  }
});
test('phase and day/night transitions finish fading before removal', () => {
  for (const kind of ['campaign','exile-vote','day','night'] as const) {
    const item: PresentationItem = { id:'test', kind, day:1, seats:[] };
    const end = kind === 'day' || kind === 'night' ? 2000 : 1800;
    assert.equal(presentationMotion(item, end - 351).exiting, false);
    assert.equal(presentationMotion(item, end - 350).exiting, true);
    assert.equal(presentationMotion(item, end - 1).done, false);
    assert.equal(presentationMotion(item, end).done, true);
    assert.equal(presentationMotion(item, 300, true).done, true);
  }
});
