import { ModRegistry as PlatformRegistry, type ModDefinition as PlatformDefinition } from '@game-ai/platform';
import { validateNpcs, type NpcDefinition } from './npc.ts';

export interface ModDefinition extends PlatformDefinition {
  id: string; version: string; contractVersion: number; contentVersion: string; worldviewVersion: string;
  configSchema: object; config: unknown; startRoomId: string;
  rooms: { id: string }[]; exits: { id: string; from: string; to: string }[];
  npcs: Pick<NpcDefinition, 'id' | 'initialRoomId'>[]; actions: string[];
}

export class ModRegistry extends PlatformRegistry<ModDefinition> {
  register(definition: ModDefinition) {
    const unique = (ids: string[]) => ids.every(id => !!id) && new Set(ids).size === ids.length;
    const rooms = new Set(definition.rooms.map(r => r.id));
    if (!unique(definition.rooms.map(r => r.id)) || !rooms.has(definition.startRoomId) || !unique(definition.actions) || !definition.actions.length) throw new Error('Invalid rooms or actions');
    if (!unique(definition.exits.map(e => e.id)) || definition.exits.some(e => !rooms.has(e.from) || !rooms.has(e.to))) throw new Error('Invalid exits');
    validateNpcs(definition.npcs, rooms);
    const reached = new Set([definition.startRoomId]);
    for (const id of reached) for (const exit of definition.exits) if (exit.from === id) reached.add(exit.to);
    if (reached.size !== rooms.size) throw new Error('Unreachable rooms');
    super.register(definition);
  }
}
