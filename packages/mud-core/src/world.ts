import { validateMap, type MapDefinition } from './map.ts';
import { validateNpcs, type NpcDefinition } from './npc.ts';

export interface World extends MapDefinition { npcs: NpcDefinition[] }

export function validateWorld(value: World, start = value.rooms[0]?.id) {
  validateMap(value, start);
  validateNpcs(value.npcs, new Set(value.rooms.map(room => room.id)));
}
