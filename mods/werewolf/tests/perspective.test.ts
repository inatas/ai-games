import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoClock } from './demo-clock.ts';
import { buildWerewolfDemo } from '../../../apps/server/src/werewolf-demo.ts';

test('PV public and seat perspectives are isolated across a complete game', () => {
  const clock = demoClock();
  let game = clock.rooms.create(22, 'random');
  for (let i = 0; i < 400 && game.status === 'running'; i++) {
    assert.deepEqual(clock.rooms.get(game.id).perspective, { kind: 'public' });
    for (let seat = 1; seat <= 12; seat++) {
      const result = clock.rooms.get(game.id, seat);
      const p = result.perspective;
      assert.equal(p.kind, 'seat');
      if (p.kind !== 'seat') throw new Error('missing seat');
      assert.equal(p.seat, seat);
      assert.deepEqual(result.events, game.events);
      assert.equal(result.speakerSeat, game.speakerSeat);
      assert.equal(result.revision, game.revision);
      if (p.role !== 'wolf') { assert.equal(p.wolves, undefined); assert.equal(p.knives, undefined); }
      if (p.role !== 'seer') assert.equal(p.inspections, undefined);
      if (p.role !== 'witch') { assert.equal(p.medicine, undefined); assert.equal(p.knife, undefined); }
      for (const death of p.deaths) assert.equal(result.players.find(x => x.seat === death.seat)?.alive, false);
    }
    game = clock.advance(game.id);
  }
  assert.equal(game.status, 'finished');
  assert.throws(() => clock.rooms.get(game.id, 13));
});

test('PV HTTP validates optional seat query and defaults to public', async () => {
  const app = await buildWerewolfDemo();
  try {
    const created = (await app.inject({ method: 'POST', url: '/api/werewolf/demo', payload: { seed: 22, strategy: 'random' } })).json();
    for (const seat of ['0', '13', '1.5', 'abc', '']) assert.equal((await app.inject(`/api/werewolf/demo/${created.id}?seat=${seat}`)).statusCode, 400);
    assert.equal((await app.inject(`/api/werewolf/demo/${created.id}?seat=1`)).json().perspective.seat, 1);
    assert.equal((await app.inject(`/api/werewolf/demo/${created.id}`)).json().perspective.kind, 'public');
  } finally { await app.close(); }
});

test('PV witch knife authorization and announced poison/knife deaths', async () => {
  const { createMatch } = await import('../src/match.ts');
  const { projectPerspective } = await import('../src/perspective.ts');
  const { settleNight, announceDeaths } = await import('../src/rules.ts');
  const match = createMatch({ seed: 22, sheriff: 'double' });
  const witch = match.game.players.find(p => p.role === 'witch')!.seat;
  const wolf = match.game.players.find(p => p.role === 'wolf')!.seat;
  const target = match.game.players.find(p => p.role === 'villager')!.seat;
  match.stage = 'witch'; match.knife = target;
  const read = (seat: number) => { const p = projectPerspective(match, seat); if (p.kind !== 'seat') throw new Error(); return p; };
  assert.equal(read(witch).knife, target);
  match.knife = null; assert.equal(read(witch).knife, null);
  match.game.antidote = false; assert.equal('knife' in read(witch), false);
  match.game.antidote = true; match.game.players[witch - 1].alive = false;
  assert.equal('knife' in read(witch), false);
  match.game.players[witch - 1].alive = true;
  match.events.push({ type: 'wolf-knife', audience: [wolf], data: { night: 1, target } });
  match.events.push({ type: 'medicine', audience: [witch], data: { seat: witch, action: { kind: 'poison', target } } });
  match.game = settleNight(match.game, target, target);
  assert.deepEqual(read(witch).deaths, []);
  assert.deepEqual(read(wolf).deaths, []);
  match.game = announceDeaths(match.game);
  assert.deepEqual(read(witch).deaths, [{ seat: target, cause: 'poison' }]);
  assert.deepEqual(read(wolf).deaths, []);
  assert.deepEqual(projectPerspective(match, null), { kind: 'public' });
});
