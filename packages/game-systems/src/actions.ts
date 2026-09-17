import { randomUUID } from 'node:crypto';
import { HarnessError, type Binding, type HarnessStore, type Json, type Transaction } from '@game-ai/core';
import { EventRuntime, type EventAudience, type EventStore, type FactEvent } from '@game-ai/platform';
import { validateMap, type Exit, type MapDefinition } from './map.ts';

export type ActorRef = { kind: 'character'; scopeId: string } | { kind: 'npc'; realmId: string; npcId: string };
export interface ActorState {
  ref: ActorRef; scopeId: string; realmId: string; roomId: string | null;
  version: string; contentVersion: string;
}

export async function initializeNpcActor(tx: Transaction, realmId: string, npcId: string, actions: string[]) {
  const realm = (await tx.query('SELECT * FROM mud_realms WHERE id=$1 FOR UPDATE', [realmId])).rows[0];
  if (!realm || !(await tx.query('SELECT 1 FROM mud_npcs WHERE realm_id=$1 AND npc_id=$2', [realmId, npcId])).rowCount || !actions.length) throw new HarnessError('INVALID_ACTOR');
  const existing = (await tx.query('SELECT scope_id,actions FROM game_npc_actors WHERE realm_id=$1 AND npc_id=$2', [realmId, npcId])).rows[0];
  if (existing) {
    if (JSON.stringify([...existing.actions].sort()) !== JSON.stringify([...new Set(actions)].sort())) throw new HarnessError('ACTOR_CONFIG_CONFLICT');
    return existing.scope_id as string;
  }
  const scopeId = randomUUID();
  await tx.query('INSERT INTO fw_scopes(id) VALUES($1)', [scopeId]);
  await tx.query('INSERT INTO game_npc_actors(realm_id,npc_id,scope_id,actions) VALUES($1,$2,$3,$4)', [realmId, npcId, scopeId, [...new Set(actions)]]);
  return scopeId;
}

/** Trusted server entry; public HTTP continues to derive scope from the account session. */
export async function lockActor(tx: Transaction, scopeId: string, actionId: string): Promise<ActorState> {
  const character = (await tx.query('SELECT realm_id FROM mud_characters WHERE scope_id=$1', [scopeId])).rows[0];
  const npc = character ? undefined : (await tx.query('SELECT realm_id,npc_id FROM game_npc_actors WHERE scope_id=$1', [scopeId])).rows[0];
  const realmId = character?.realm_id ?? npc?.realm_id;
  if (!realmId) throw new HarnessError('FORBIDDEN', 403);
  const realm = (await tx.query('SELECT * FROM mud_realms WHERE id=$1 FOR UPDATE', [realmId])).rows[0];
  if (character) {
    const row = (await tx.query('SELECT room_id FROM mud_characters WHERE scope_id=$1 AND active', [scopeId])).rows[0];
    if (!row) throw new HarnessError('FORBIDDEN', 403);
    return { ref: { kind: 'character', scopeId }, scopeId, realmId, roomId: row.room_id, contentVersion: realm.content_version, version: `${realm.revision}:${row.room_id}` };
  }
  const row = (await tx.query(`SELECT n.room_id,n.revision FROM game_npc_actors a JOIN mud_npcs n USING(realm_id,npc_id)
    WHERE a.scope_id=$1 AND a.enabled AND $2=ANY(a.actions) AND n.status='present'`, [scopeId, actionId])).rows[0];
  if (!row) throw new HarnessError('FORBIDDEN', 403);
  return { ref: { kind: 'npc', realmId, npcId: npc!.npc_id }, scopeId, realmId, roomId: row.room_id || null, contentVersion: realm.content_version, version: `${realm.revision}:${row.revision}:${row.room_id}` };
}

export function createActionEvents(store: EventStore) {
  const events = new EventRuntime(store, { async validateSubject(tx, realmId, subject) {
    return subject.kind === 'npc' && !!(await tx.query("SELECT 1 FROM mud_npcs WHERE realm_id=$1 AND npc_id=$2 AND status='present'", [realmId, subject.id])).rowCount;
  } });
  events.registerType('actor.moved', { type: 'object', additionalProperties: false, required: ['from', 'to', 'exitId'], properties: { from: { type: 'string' }, to: { type: 'string' }, exitId: { type: 'string' } } });
  return events;
}

export interface MoveOptions {
  map: MapDefinition; events: EventRuntime;
  denial?: (tx: Transaction, actor: ActorState, exit: Exit) => Promise<string | null>;
  audience?: (tx: Transaction, actor: ActorState, event: FactEvent) => Promise<EventAudience[]>;
}

export async function moveActor(tx: Transaction, actor: ActorState, exitId: string, requestId: string, options: MoveOptions, cause?: { eventId: string; depth: number }) {
  const exit = options.map.exits.find(e => e.id === exitId && e.from === actor.roomId);
  if (!exit || !options.map.rooms.some(r => r.id === exit.to)) throw new HarnessError('RULE_REJECTED', 409, 'NOT_ADJACENT');
  if (actor.contentVersion !== options.map.version) throw new HarnessError('CONTENT_VERSION_CONFLICT');
  if (exit.conditions?.length && !options.denial) throw new HarnessError('RULE_REJECTED', 409, 'MISSING_RULE_EVALUATOR');
  const denial = await options.denial?.(tx, actor, exit);
  if (denial) throw new HarnessError('RULE_REJECTED', 409, denial);
  const event: FactEvent = { eventId: randomUUID(), realmId: actor.realmId, type: 'actor.moved', actor: { kind: actor.ref.kind, id: actor.ref.kind === 'character' ? actor.scopeId : actor.ref.npcId }, requestId,
    causationId: cause?.eventId ?? null, chainDepth: cause ? cause.depth + 1 : 0, contentVersion: actor.contentVersion, createdAt: Date.now(), payload: { from: actor.roomId!, to: exit.to, exitId } };
  const audience = await options.audience?.(tx, actor, event) ?? [];
  if (actor.ref.kind === 'character') await tx.query('UPDATE mud_characters SET room_id=$2 WHERE scope_id=$1', [actor.scopeId, exit.to]);
  else await tx.query('UPDATE mud_npcs SET room_id=$3,revision=revision+1 WHERE realm_id=$1 AND npc_id=$2', [actor.realmId, actor.ref.npcId, exit.to]);
  await tx.query('UPDATE mud_realms SET revision=revision+1 WHERE id=$1', [actor.realmId]);
  await options.events.append(tx, event, audience);
  return { from: actor.roomId!, to: exit.to, exitId };
}

export const moveInputSchema = { type: 'object', additionalProperties: false, required: ['exitId'], properties: { exitId: { type: 'string', minLength: 1 }, note: { type: 'string', maxLength: 200 }, causationId: { type: 'string', pattern: '^[0-9a-fA-F-]{36}$' }, chainDepth: { type: 'integer', minimum: 0, maximum: 4 } } };

export function moveBinding(store: HarnessStore, options: MoveOptions & { id: string }): Binding {
  validateMap(options.map);
  return {
    id: options.id, version: '1', mode: 'recordMemory',
    inputSchema: moveInputSchema,
    lockResources: (tx, scopeId) => lockActor(tx, scopeId, 'move'),
    async prepare(input, scopeId) {
      return store.transaction(async tx => {
        const actor = await lockActor(tx, scopeId, 'move');
        return { gameVersion: `${options.map.version}:${actor.version}`, facts: { roomId: actor.roomId }, instructions: '', subjectIds: [], tags: [], requiredMemoryIds: [] };
      });
    },
    validate: () => ({ ok: true }),
    async apply(tx, proposal, context) {
      const actor = await lockActor(tx, context.scopeId, 'move');
      if (`${options.map.version}:${actor.version}` !== context.gameVersion) throw new HarnessError('STATE_CONFLICT');
      const input = context.input as { exitId: string; causationId?: string; chainDepth?: number };
      if ((input.causationId === undefined) !== (input.chainDepth === undefined)) throw new HarnessError('INVALID_CAUSATION');
      const result = await moveActor(tx, actor, input.exitId, context.requestId, options, input.causationId ? { eventId: input.causationId, depth: input.chainDepth! } : undefined);
      return { result: result as Json, memoryChanges: [] };
    },
  };
}
