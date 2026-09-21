import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, exile, inspectSeat, settleNight, announceDeaths, useMedicine, type GameState } from '../src/rules.ts';
import { projectGame, revealGame } from '../src/views.ts';
import { createRoom, occupySeat, spectatorView, actorView, type RoomDefinition } from '@game-ai/turn-based';
import type { Json } from '@game-ai/core';

function game(): GameState {
  const state = createGame(42);
  const roles = ['wolf', 'wolf', 'wolf', 'wolf', 'villager', 'villager',
    'villager', 'villager', 'seer', 'witch', 'hunter', 'idiot'] as const;
  state.players.forEach((p, i) => { p.role = roles[i]; });
  return state;
}

test('WW-43–45: seat projection exposes only own role and authorized private facts', () => {
  const state = inspectSeat(game(), 9, 10).state;
  for (let seat = 1; seat <= 12; seat++) {
    const view = projectGame(state, seat, { phase: 'witch', knife: 5 });
    assert.equal(view.self?.role, state.players[seat - 1].role);
    assert.equal('wolves' in view.self!, seat <= 4);
    assert.equal('inspections' in view.self!, seat === 9);
    assert.equal('medicine' in view.self!, seat === 10);
    assert.equal('knife' in view.self!, seat === 10);
    assert.equal('canShoot' in view.self!, seat === 11);
    assert.ok(view.players.every(p => !('role' in p)));
    assert.equal('random' in view, false);
  }
  const seer = projectGame(state, 9, { phase: 'night' });
  assert.deepEqual(seer.self?.inspections, [{ night: 1, target: 10, alignment: 'good' }]);
  const publicView = projectGame(state, null, { phase: 'witch', knife: 5 });
  assert.equal('self' in publicView, false);
  assert.equal('knife' in publicView, false);
  assert.throws(() => projectGame(state, 99, { phase: 'night' }), /INVALID_VIEWER/);
});

test('WW-18,44: knife is visible only during witch decision while antidote remains', () => {
  const state = game();
  assert.equal(projectGame(state, 10, { phase: 'witch', knife: 5 }).self?.knife, 5);
  assert.equal('knife' in projectGame(state, 10, { phase: 'day' }).self!, false);
  const spent = useMedicine(state, 10, 5, { kind: 'save' }).state;
  assert.equal('knife' in projectGame(spent, 10, { phase: 'witch', knife: 6 }).self!, false);
  assert.equal(projectGame(state, 10, { phase: 'witch', knife: null }).self?.knife, null);
});

test('WW-45,49,72: unannounced night deaths and private phase keys do not leak; idiot reveal is public', () => {
  const night = settleNight(game(), 5, 6);
  const before = projectGame(night, null, { phase: 'seer' });
  assert.equal(before.period, 'night');
  assert.ok(before.players.every(p => p.alive));
  assert.equal(JSON.stringify(before).includes('seer'), false);
  const after = projectGame(announceDeaths(night), null, { phase: 'day' });
  assert.deepEqual(after.players.filter(p => !p.alive).map(p => p.seat), [5, 6]);
  assert.ok(after.players.every(p => !('death' in p)));
  const idiot = projectGame(exile(game(), 12), null, { phase: 'day' });
  assert.equal(idiot.players[11].revealedRole, 'idiot');
  assert.equal(idiot.players[11].alive, true);
});

test('WW-46: ordinary projection never reveals; explicit trusted replay contains roles and is detached', () => {
  const state = game();
  const replay = revealGame(state);
  assert.equal(replay.players[0].role, 'wolf');
  replay.players[0].role = 'villager';
  assert.equal(state.players[0].role, 'wolf');
  assert.equal('role' in projectGame(state, null, { phase: 'day' }).players[0], false);
});

test('WW-43,46: actual framework views isolate private events and only finish enables MOD replay', () => {
  const definition: RoomDefinition = {
    id: 'werewolf-view-test', version: '1', seats: 12, instructions: '',
    initialize: () => ({
      state: game() as unknown as Json,
      phase: { key: 'wolves', label: '夜间行动', round: 1, mode: 'sealed', actors: [1, 2, 3, 4], schema: { type: 'null' } },
      events: [{ type: 'wolf-knife', audience: [1, 2, 3, 4], data: { target: 5 } }],
    }),
    project: (state, viewer) => projectGame(state as unknown as GameState, viewer, { phase: 'wolves' }) as unknown as Json,
    reveal: state => revealGame(state as unknown as GameState) as unknown as Json,
    validate: () => true,
    resolve: state => ({ state, result: null }),
  };
  let room = createRoom('view-room', 'view-run', definition);
  for (let seat = 1; seat <= 12; seat++) {
    room = occupySeat(room, { seat, name: `AI ${seat}`, modelProfile: 'test', scopeId: `seat-${seat}` }, definition);
  }
  assert.ok(JSON.stringify(actorView(room, 1, definition)).includes('wolf-knife'));
  assert.equal(JSON.stringify(actorView(room, 5, definition)).includes('wolf-knife'), false);
  for (const status of ['running', 'blocked', 'aborted'] as const) {
    const view = spectatorView({ ...room, status }, definition);
    assert.equal('replay' in view, false);
    assert.equal(view.events.length, 0);
    assert.equal(JSON.stringify(view.state).includes('wolf'), false);
    assert.equal(view.phase?.label, '夜间行动');
  }
  const finished = spectatorView({ ...room, status: 'finished', phase: null }, definition);
  assert.ok(JSON.stringify(finished.replay).includes('wolf'));
  assert.equal(finished.events[0].type, 'wolf-knife');
  assert.equal(JSON.stringify(actorView({ ...room, status: 'finished' }, 5, definition)).includes('wolf-knife'), false);
});
