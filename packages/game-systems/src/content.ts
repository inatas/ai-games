import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { Ajv, type ValidateFunction } from 'ajv';
import type { Json } from '@game-ai/core';
import { validateMap, type Exit, type MapDefinition, type RuleCondition } from './map.ts';
import { validateNpcs, type NpcDefinition } from './npc.ts';

export class RuleRegistry {
  private readonly rules = new Map<string, { validate: ValidateFunction; check: (facts: Record<string, Json>, params: Json) => string | null }>();
  register(id: string, schema: object, check: (facts: Record<string, Json>, params: Json) => string | null) {
    if (!id || this.rules.has(id)) throw Error('DUPLICATE_RULE');
    this.rules.set(id, { validate: new Ajv({ strict: true }).compile(schema), check });
    return this;
  }
  validate(conditions: RuleCondition[]) {
    for (const condition of conditions) {
      const rule = this.rules.get(condition.ruleId);
      if (!rule) throw Error(`UNKNOWN_RULE: ${condition.ruleId}`);
      if (!rule.validate(condition.params)) throw Error(`INVALID_RULE_PARAMS: ${condition.ruleId}`);
    }
  }
  denial(exit: Pick<Exit, 'conditions'>, facts: Record<string, Json>) {
    this.validate(exit.conditions ?? []);
    for (const condition of exit.conditions ?? []) {
      const reason = this.rules.get(condition.ruleId)!.check(facts, condition.params);
      if (reason) return reason;
    }
    return null;
  }
}

const text = { type: 'string', minLength: 1 };
const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, required, properties });
const list = (items: object) => ({ type: 'array', items });
const condition = object({ ruleId: text, params: {} });
const room = object({ id: text, name: text, kind: { enum: ['street', 'indoor', 'wild'] }, templateId: { enum: ['street', 'indoor', 'wild'] }, description: { type: 'string' }, layout: object({ x: { type: 'number' }, y: { type: 'number' } }) });
const exit = object({ id: text, from: text, to: text, direction: text, conditions: list(condition) }, ['id', 'from', 'to', 'direction']);
const mapSchema = object({ version: text, rooms: list(room), exits: list(exit) });
const npcSchema = list(object({ id: text, name: text, description: { type: 'string' }, initialRoomId: text }, ['id', 'name', 'description']));
const manifestSchema = object({ id: text, contentVersion: text, startRoomId: text, map: text, npcs: text, behaviors: text, actions: { type: 'array', minItems: 1, uniqueItems: true, items: text }, rules: { type: 'array', uniqueItems: true, items: text } });
export interface ContentManifest {
  id: string; contentVersion: string; startRoomId: string; map: string; npcs: string; behaviors: string; actions: string[]; rules: string[];
}
export interface GameContent { manifest: ContentManifest; map: MapDefinition; npcs: NpcDefinition[]; behaviors: Json[] }

export function loadContent(directory: string, rules: RuleRegistry, actionIds: readonly string[]): GameContent {
  const root = realpathSync(directory);
  const ajv = new Ajv({ strict: true });
  function load<T>(path: string, schema: object): T {
    const file = realpathSync(resolve(root, path));
    const rel = relative(root, file);
    if (!rel || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel)) throw Error('CONTENT_PATH_ESCAPE');
    const raw = readFileSync(file, 'utf8');
    if (Buffer.byteLength(raw) > 2 * 1024 * 1024) throw Error('CONTENT_TOO_LARGE');
    const value: unknown = JSON.parse(raw);
    if (!ajv.validate(schema, value)) throw Error(`INVALID_CONTENT: ${path}`);
    return value as T;
  }
  const manifest = load<ContentManifest>('manifest.json', manifestSchema);
  if (manifest.actions.some(id => !actionIds.includes(id))) throw Error('UNKNOWN_ACTION');
  const map = load<MapDefinition>(manifest.map, mapSchema);
  const npcs = load<NpcDefinition[]>(manifest.npcs, npcSchema);
  const behaviors = load<Json[]>(manifest.behaviors, { type: 'array', items: { type: 'object' } });
  if (manifest.contentVersion !== map.version) throw Error('CONTENT_VERSION_CONFLICT');
  validateMap(map, manifest.startRoomId);
  validateNpcs(npcs, new Set(map.rooms.map(r => r.id)));
  for (const e of map.exits) {
    if (e.conditions?.some(c => !manifest.rules.includes(c.ruleId))) throw Error('UNDECLARED_RULE');
    rules.validate(e.conditions ?? []);
  }
  return { manifest, map, npcs, behaviors };
}
