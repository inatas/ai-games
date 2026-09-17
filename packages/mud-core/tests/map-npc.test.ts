import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectMap, validateMap, validateNpcs, type MapDefinition } from '../src/index.ts';

test('map validation and projection need no NPC directory', () => {
  const map: MapDefinition = { version: '1', rooms: [{ id: 'room', name: 'Room', kind: 'indoor', templateId: 'indoor', description: '', layout: { x: 0, y: 0 } }], exits: [] };
  validateMap(map);
  assert.equal(projectMap(map, 'room', new Set(['room']), () => null).nodes.length, 1);
});

test('NPCs can be offstage; duplicate identities and invalid placements are rejected', () => {
  const rooms = new Set(['room']);
  validateNpcs([{ id: 'offstage' }, { id: 'resident', initialRoomId: 'room' }], rooms);
  assert.throws(() => validateNpcs([{ id: 'a' }, { id: 'a' }], rooms));
  assert.throws(() => validateNpcs([{ id: '' }], rooms));
  assert.throws(() => validateNpcs([{ id: 'a', initialRoomId: 'missing' }], rooms));
  assert.throws(() => validateNpcs([{ id: 'a', initialRoomId: '' }], rooms));
});
