import { ModRegistry } from '@game-ai/mud-core';
import { world } from './world.ts';

export const realmId = 'qingxi';
export const manifest = {
  id: 'qingxi', version: '1', contractVersion: 1, contentVersion: world.version, worldviewVersion: '1',
  configSchema: { type: 'object', additionalProperties: false }, config: {},
  startRoomId: 'gate', rooms: world.rooms, exits: world.exits, npcs: world.npcs,
  actions: ['good_deed','encounter','apprenticeship','challenge','move','talk','accept_quest','pickup','give','set_profile','join_school','learn_skill','accept_school_quest','turn_in_school_quest','attack','use_skill','escort_accept','escort_contribute','escort_complete','escort_claim'],
};
const registry = new ModRegistry();
registry.register(manifest);
