import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldPlayNightMusic, nightMusicVolume, announcementForKind } from '../web/night-music.ts';

test('night music follows only an enabled, visible, running match', () => {
  assert.equal(shouldPlayNightMusic(true, true, 'running', 'night', false), true);
  for (const state of [
    [false, true, 'running', 'night', false], [true, false, 'running', 'night', false],
    [true, true, 'running', 'day', false], [true, true, 'finished', 'night', false],
    [true, true, 'running', 'night', true],
  ] as const) assert.equal(shouldPlayNightMusic(state[0], state[1], state[2], state[3], state[4]), false);
});

test('night music fades into the chosen level and fades out to silence', () => {
  assert.equal(nightMusicVolume(0, .2, 0, 1200), 0);
  assert.equal(nightMusicVolume(0, .2, 600, 1200), .1);
  assert.equal(nightMusicVolume(0, .2, 1200, 1200), .2);
  assert.equal(nightMusicVolume(.2, 0, 1000, 1000), 0);
});

test('only day and night scene cards select their matching spoken announcement', () => {
  assert.deepEqual(announcementForKind('night'), { src: '/werewolf/audio/night-announcement.mp3', text: '天黑了' });
  assert.deepEqual(announcementForKind('day'), { src: '/werewolf/audio/day-announcement.mp3', text: '天亮了' });
  for (const kind of ['campaign', 'exile-vote', 'result']) assert.equal(announcementForKind(kind), null);
});
