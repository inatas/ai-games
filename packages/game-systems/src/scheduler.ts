import { randomUUID } from 'node:crypto';
import { canonical, Harness, HarnessError, type AssessmentInput, type HarnessStore, type Json, type Transaction } from '@game-ai/core';
import type { EventConsumer } from '@game-ai/platform';
import { initializeNpcActor } from './actions.ts';
import { chooseBehavior, validateBehavior, type BehaviorCursor, type BehaviorDefinition } from './behavior.ts';
import type { RuleRegistry } from './content.ts';

interface SchedulerOptions {
  realmId: string; contentVersion: string; bindings: Record<string, string>; rules: RuleRegistry;
  facts(tx: Transaction, npcId: string): Promise<Record<string, Json>>;
  now?: () => number;
}
interface Pending { request: AssessmentInput; path: string; followup?: boolean }

export class NpcScheduler {
  private readonly trees = new Map<string, BehaviorDefinition>();
  private readonly now: () => number;
  constructor(private readonly store: HarnessStore, private readonly harness: Harness, private readonly options: SchedulerOptions) { this.now = options.now ?? Date.now; }
  async initialize(trees: BehaviorDefinition[]) {
    const ids = new Set<string>(), npcs = new Set<string>();
    for (const tree of trees) {
      validateBehavior(tree, Object.keys(this.options.bindings), this.options.rules.ids(), (ruleId, params) => this.options.rules.validate([{ ruleId, params }]), (id, params) => {
        if (!this.harness.validateInput(this.options.bindings[id], params)) throw Error('INVALID_ACTION_PARAMS');
      });
      if (ids.has(tree.id) || npcs.has(tree.npcId)) throw Error('DUPLICATE_BEHAVIOR');
      ids.add(tree.id); npcs.add(tree.npcId);
    }
    await this.store.transaction(async tx => {
      const realm = (await tx.query('SELECT content_version FROM mud_realms WHERE id=$1 FOR UPDATE', [this.options.realmId])).rows[0];
      if (!realm || realm.content_version !== this.options.contentVersion) throw Error('CONTENT_VERSION_CONFLICT');
      const installed = (await tx.query('SELECT behavior_id FROM game_npc_behaviors WHERE realm_id=$1', [this.options.realmId])).rows;
      if (installed.some(row => !ids.has(row.behavior_id))) throw Error('BEHAVIOR_VERSION_CONFLICT');
      for (const tree of trees) {
        const scopeId = await initializeNpcActor(tx, this.options.realmId, tree.npcId, Object.keys(this.options.bindings));
        await tx.query(`INSERT INTO game_npc_behaviors(realm_id,npc_id,scope_id,behavior_id,content_version,definition,next_wake_at)
          VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`, [this.options.realmId, tree.npcId, scopeId, tree.id, this.options.contentVersion, JSON.stringify(tree), this.now()]);
        const row = (await tx.query('SELECT content_version,definition FROM game_npc_behaviors WHERE scope_id=$1', [scopeId])).rows[0];
        if (row.content_version !== this.options.contentVersion || canonical(row.definition) !== canonical(tree)) throw Error('BEHAVIOR_VERSION_CONFLICT');
      }
    });
    this.trees.clear(); trees.forEach(tree => this.trees.set(tree.id, tree));
  }
  consumer(id = 'npc.wake'): EventConsumer {
    return { id, types: ['actor.moved'], apply: async (tx, delivery) => {
      if (delivery.event.chainDepth >= 4) throw new HarnessError('EVENT_CHAIN_LIMIT');
      if (delivery.recipient.kind !== 'npc' || delivery.event.realmId !== this.options.realmId) throw new HarnessError('INVALID_RECIPIENT');
      await tx.query(`UPDATE game_npc_behaviors SET next_wake_at=LEAST(next_wake_at,$3),cause=COALESCE(cause,$4::jsonb)
        WHERE realm_id=$1 AND npc_id=$2 AND enabled`, [this.options.realmId, delivery.recipient.id, this.now(), JSON.stringify({ causationId: delivery.event.eventId, chainDepth: delivery.event.chainDepth })]);
    } };
  }
  async tick() {
    const rows = (await this.store.pool.query(`SELECT scope_id FROM game_npc_behaviors WHERE realm_id=$1 AND enabled
      AND (next_wake_at<=$2 OR pending IS NOT NULL) ORDER BY next_wake_at,scope_id LIMIT 20`, [this.options.realmId, this.now()])).rows;
    for (const row of rows) {
      const pending = await this.plan(row.scope_id);
      if (!pending) continue;
      try { await this.harness.submit(pending.request); }
      catch (error) {
        if (!(error instanceof HarnessError)) throw error;
        // A concurrent claimant may be executing this same persisted request.
        if (error.code === 'SCOPE_BUSY') continue;
        await this.store.transaction(async tx => {
          await tx.query(`UPDATE game_npc_behaviors SET pending=NULL,cursor='{}',last_error=$3,next_wake_at=$4
            WHERE scope_id=$1 AND pending->'request'->>'requestId'=$2`, [row.scope_id, pending.request.requestId, error.code, this.now() + 1000]);
        });
      }
    }
  }
  private async plan(scopeId: string): Promise<Pending | null> {
    return this.store.transaction(async tx => {
      const realm = (await tx.query('SELECT content_version FROM mud_realms WHERE id=$1 FOR UPDATE', [this.options.realmId])).rows[0];
      const scope = (await tx.query('SELECT memory_version FROM fw_scopes WHERE id=$1 FOR UPDATE', [scopeId])).rows[0];
      const row = (await tx.query(`SELECT b.* FROM game_npc_behaviors b JOIN game_npc_actors a USING(scope_id)
        WHERE b.scope_id=$1 AND b.enabled AND a.enabled FOR UPDATE OF b`, [scopeId])).rows[0];
      if (!row) return null;
      if (realm.content_version !== this.options.contentVersion) throw Error('CONTENT_VERSION_CONFLICT');
      const tree = this.trees.get(row.behavior_id);
      if (!tree) throw Error('UNKNOWN_BEHAVIOR');
      const cursor: BehaviorCursor = row.cursor;
      if (row.pending) {
        const pending: Pending = row.pending;
        const request = (await tx.query('SELECT status,error,result FROM fw_requests WHERE scope_id=$1 AND request_id=$2', [scopeId, pending.request.requestId])).rows[0];
        if (!request) return pending;
        if (request.status === 'processing') return null;
        const next = request.result?.nextAction;
        if (request.status === 'committed' && next && !pending.followup) {
          if (!Object.hasOwn(this.options.bindings, next.actionId) || ['decide', 'narrate'].includes(next.actionId)) throw new HarnessError('INVALID_CHOICE');
          const source = pending.request.input as Record<string, Json>;
          const followup: Pending = { path: pending.path, followup: true, request: { scopeId, requestId: randomUUID(), expectedMemoryVersion: scope.memory_version, bindingId: this.options.bindings[next.actionId], bindingVersion: '1', input: { ...next.params, ...(source.causationId ? { causationId: source.causationId, chainDepth: source.chainDepth } : {}) } } };
          await tx.query('UPDATE game_npc_behaviors SET pending=$2,revision=revision+1 WHERE scope_id=$1', [scopeId, JSON.stringify(followup)]);
          return followup;
        }
        cursor[pending.path] = request.status === 'committed' ? 'success' : 'failure';
        const modelFailed = request.status !== 'committed' && /^MODEL_/.test(request.error?.code ?? '');
        const nextWake = row.cause ? this.now() : modelFailed ? Number.MAX_SAFE_INTEGER : this.now() + tree.intervalMs;
        await tx.query('UPDATE game_npc_behaviors SET cursor=$2,pending=NULL,last_error=$3,next_wake_at=$4,revision=revision+1 WHERE scope_id=$1', [scopeId, JSON.stringify(modelFailed ? {} : cursor), request.error?.code ?? null, nextWake]);
        return null;
      }
      if (Number(row.next_wake_at) > this.now()) return null;
      const facts = await this.options.facts(tx, tree.npcId);
      const choice = chooseBehavior(tree, (ruleId, params) => this.options.rules.denial({ conditions: [{ ruleId, params }] }, facts) === null, cursor);
      let pending: Pending | null = null;
      if (choice.action) pending = { path: choice.path!, request: { scopeId, requestId: randomUUID(), expectedMemoryVersion: scope.memory_version, bindingId: this.options.bindings[choice.action.actionId], bindingVersion: '1', input: { ...choice.action.params, ...(row.cause ?? {}) } } };
      await tx.query(`UPDATE game_npc_behaviors SET cursor=$2,pending=$3,cause=NULL,next_wake_at=$4,revision=revision+1,last_error=$5 WHERE scope_id=$1`, [scopeId, JSON.stringify(choice.completed), pending ? JSON.stringify(pending) : null, this.now() + tree.intervalMs, choice.status === 'failure' ? 'BEHAVIOR_FAILED' : null]);
      return pending;
    });
  }
}
