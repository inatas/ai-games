import { Ajv } from 'ajv';
import { validateNpcs, type NpcDefinition } from './npc.ts';

export interface ModDefinition {
  id: string; version: string; contractVersion: number; contentVersion: string; worldviewVersion: string;
  configSchema: object; config: unknown; startRoomId: string;
  rooms: { id: string }[]; exits: { id: string; from: string; to: string }[];
  npcs: Pick<NpcDefinition, 'id' | 'initialRoomId'>[]; actions: string[];
}

export class ModRegistry {
  private definitions = new Map<string, ModDefinition>();
  register(definition: ModDefinition) {
    const key = `${definition.id}@${definition.version}`;
    if (definition.contractVersion !== 1 || !definition.id || !definition.version || !definition.contentVersion || !definition.worldviewVersion || this.definitions.has(key)) throw new Error(`Invalid MOD identity: ${key}`);
    if (!new Ajv({ strict: true }).validate(definition.configSchema, definition.config)) throw new Error(`Invalid MOD configuration: ${key}`);
    const unique = (ids: string[]) => ids.every(id => !!id) && new Set(ids).size === ids.length;
    const rooms = new Set(definition.rooms.map(r => r.id));
    if (!unique(definition.rooms.map(r => r.id)) || !rooms.has(definition.startRoomId) || !unique(definition.actions) || !definition.actions.length) throw new Error('Invalid rooms or actions');
    if (!unique(definition.exits.map(e => e.id)) || definition.exits.some(e => !rooms.has(e.from) || !rooms.has(e.to))) throw new Error('Invalid exits');
    validateNpcs(definition.npcs, rooms);
    const reached = new Set([definition.startRoomId]);
    for (const id of reached) for (const exit of definition.exits) if (exit.from === id) reached.add(exit.to);
    if (reached.size !== rooms.size) throw new Error('Unreachable rooms');
    this.definitions.set(key, structuredClone(definition));
  }
  get(id: string, version: string): ModDefinition {
    const definition = this.definitions.get(`${id}@${version}`);
    if (!definition) throw new Error(`Unsupported MOD: ${id}@${version}`);
    return structuredClone(definition);
  }
}
