import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ModRegistry } from '../src/index.ts';

test('MF-02/03: registry validates content and rejects ambiguous or unsupported modules', () => {
  const definition = { id: 'neutral', version: '1', contractVersion: 1, contentVersion: '1', worldviewVersion: '1',
    configSchema: { type: 'object', additionalProperties: false }, config: {},
    rooms: [{ id: 'start' }], exits: [], npcs: [], startRoomId: 'start', actions: ['inspect'] };
  const registry = new ModRegistry(); registry.register(definition);
  assert.equal(registry.get('neutral', '1').id, 'neutral');
  assert.throws(() => registry.register(definition));
  assert.throws(() => new ModRegistry().register({ ...definition, contractVersion: 2 }));
  assert.throws(() => new ModRegistry().register({ ...definition, npcs: [{ id: 'actor', initialRoomId: 'missing' }] }));
  new ModRegistry().register({ ...definition, npcs: [{ id: 'offstage' }] });
  assert.throws(() => new ModRegistry().register({ ...definition, actions: ['inspect', 'inspect'] }));
  assert.throws(() => registry.get('neutral', '2'));
});
