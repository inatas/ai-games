import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world, validateWorld, projectMap, type World } from '../src/world.ts';

test('WM-01/18: validate references, templates, reachability and directed exits', () => {
  validateWorld(world);
  assert.equal(world.rooms.length, 12);
  assert.equal(world.npcs.length, 5);
  assert.ok(world.exits.some(e => e.from === 'tea-yard' && e.to === 'street'));
  assert.ok(!world.exits.some(e => e.from === 'street' && e.to === 'tea-yard'));
  for (const mutate of [
    (w: World) => { w.rooms.push(w.rooms[0]); },
    (w: World) => { w.exits[0].to = 'missing'; },
    (w: World) => { w.rooms[0].templateId = 'missing' as any; },
    (w: World) => { w.exits = w.exits.filter(e => e.to !== 'inner'); },
  ]) {
    const broken = structuredClone(world); mutate(broken);
    assert.throws(() => validateWorld(broken));
  }
});

test('WM-03/19: frontier reveals geography, never remote occupants or locked state', () => {
  const map = projectMap(world, 'gate', new Set(['gate']), false);
  assert.deepEqual(map.nodes.map(n => n.roomId).sort(), ['gate', 'street']);
  assert.equal(map.nodes.find(n => n.roomId === 'street')?.discovery, 'frontier');
  assert.equal(map.edges[0].bidirectional, true, 'A frontier must not make a two-way road look one-way');
  const known = projectMap(world, 'dojo', new Set(world.rooms.map(r => r.id)), false);
  assert.equal(known.edges.find(e => e.from === 'dojo-yard' && e.to === 'inner')?.access, 'unknown');
  const locked = projectMap(world, 'dojo-yard', new Set(['dojo-yard']), false);
  assert.equal(locked.edges.find(e => e.to === 'inner')?.access, 'locked');
  assert.equal(projectMap(world, 'dojo-yard', new Set(['dojo-yard']), true).edges.find(e => e.to === 'inner')?.access, 'open');
  assert.ok(!JSON.stringify(known).includes('青松道人'));
});

test('WM-16/17: 3000 rooms use existing templates and bounded projection', () => {
  const large: World = { version: 'test', rooms: [], exits: [], npcs: [] };
  for (let i = 0; i < 3000; i++) {
    large.rooms.push({ id: String(i), name: `路${i}`, kind: 'wild', templateId: 'wild', description: '山路', layout: { x: i, y: 0 } });
    for (let j = 1; j <= 8 && i + j < 3000; j++) large.exits.push({ id: `${i}-${j}`, from: String(i), to: String(i + j), direction: `路${j}` });
  }
  validateWorld(large, '0');
  const began = performance.now();
  const result = projectMap(large, '0', new Set(large.rooms.map(r => r.id)), false);
  assert.ok(result.nodes.length <= 73);
  assert.ok(result.nodes.length < large.rooms.length);
  console.log(`3000 room projection: ${(performance.now() - began).toFixed(2)}ms, ${JSON.stringify(result).length} characters`);
});
