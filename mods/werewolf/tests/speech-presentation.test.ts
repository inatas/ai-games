import test from 'node:test';
import assert from 'node:assert/strict';
import { speechKey, speechLayout, revealDuration, revealClip } from '../web/speech-presentation.ts';
import { DemoRooms } from '../src/demo.ts';

test('current speech identity survives polling and distinguishes a new turn', () => {
  const base = new DemoRooms({ now: () => 0 }).create(42, 'fixed');
  const game = { ...base, period: 'day' as const, speakerSeat: 6, currentSpeech: { seat: 6, text: '我先说一下判断。', revision: 3 } };
  assert.ok(speechKey(game));
  assert.equal(speechKey(game), speechKey({ ...game, timing: { remainingMs: 900 } }));
  assert.notEqual(speechKey(game), speechKey({ ...game, currentSpeech: { ...game.currentSpeech, revision: 4 } }));
  assert.notEqual(speechKey(game), speechKey({ ...game, id: 'another-room' }));
  for (const value of [{ ...game, period: 'night' as const }, { ...game, status: 'finished' as const },
    { ...game, speakerSeat: 10 }, { ...game, currentSpeech: { ...game.currentSpeech, text: '  ' } }]) assert.equal(speechKey(value), null);
});

test('all twelve bubbles use a horizontal short tail, allowing clock overlap but keeping history clear', () => {
  for (let seat = 1; seat <= 12; seat++) {
    for (const height of [8, 16, 40]) {
      const layout = speechLayout(seat, height);
      assert.equal(layout.width, 56);
      assert.ok(layout.top >= 13 && layout.top + layout.height <= 74);
      assert.equal(layout.right, seat > 6);
      assert.equal(layout.tailOffset, 0, 'same horizontal triangle for every seat');
      assert.ok(layout.height >= 20);
    }
  }
  assert.ok(speechLayout(1, 14).top < speechLayout(10, 14).top);
  assert.ok(speechLayout(10, 14).top < speechLayout(6, 14).top);
});

test('line reveal completes within the live turn and handles short deadlines', () => {
  assert.equal(revealDuration(20, 120_000), 12_000);
  assert.equal(revealDuration(3, 120_000), 2100);
  assert.ok(revealDuration(20, 900) <= 500);
  assert.equal(revealDuration(20, 200), 0);
  assert.equal(revealClip(2100, 2100, 20, 24), 'none');
  assert.equal(revealClip(0, 0, 20, 24), 'none');
  assert.notEqual(revealClip(500, 2100, 20, 24), 'none');
});
