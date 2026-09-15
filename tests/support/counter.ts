import { randomUUID } from 'node:crypto';
import { type Binding, HarnessError, type Json, type MemoryChange } from '@game-ai/core';
import { PostgresStore } from '@game-ai/storage';

export async function counterScope(store: PostgresStore, allowed = true) {
  const scopeId = await store.createScope();
  await store.pool.query('CREATE TABLE IF NOT EXISTS test_counters(scope_id uuid PRIMARY KEY, counter integer NOT NULL DEFAULT 0, version integer NOT NULL DEFAULT 0, allowed boolean NOT NULL DEFAULT true)');
  await store.pool.query('INSERT INTO test_counters(scope_id,allowed) VALUES($1,$2)', [scopeId, allowed]);
  return scopeId;
}
export function counterBinding(store: PostgresStore, options: { increment?: number; mode?: 'assessment' | 'recordMemory'; changes?: MemoryChange[]; required?: string[] } = {}): Binding {
  return {
    id: 'counter', version: '1', mode: options.mode ?? 'assessment',
    inputSchema: { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string', minLength: 1, maxLength: 2000 } } },
    outputSchema: { type: 'object', additionalProperties: false, required: ['decision'], properties: { decision: { type: 'string', enum: ['ACCEPT','DEFER'] } } },
    async prepare(input, scopeId) {
      const row = (await store.pool.query('SELECT * FROM test_counters WHERE scope_id=$1', [scopeId])).rows[0];
      return { gameVersion: String(row.version), facts: { counter: row.counter, allowed: row.allowed }, instructions: 'Decide ACCEPT or DEFER.', subjectIds: ['counter'], tags: [], requiredMemoryIds: options.required ?? [] };
    },
    validate(proposal, facts) { return !(facts as any).allowed && (proposal as any)?.decision === 'ACCEPT' ? { ok: false, code: 'HOST_DENIED' } : { ok: true }; },
    async apply(tx, proposal, context) {
      const row = (await tx.query('SELECT * FROM test_counters WHERE scope_id=$1 FOR UPDATE', [context.scopeId])).rows[0];
      if (String(row.version) !== context.gameVersion) throw new HarnessError('STATE_CONFLICT');
      if (!row.allowed && (proposal as any)?.decision === 'ACCEPT') throw new HarnessError('RULE_REJECTED',409,'HOST_DENIED');
      const counter = row.counter + (options.mode === 'recordMemory' || (proposal as any)?.decision === 'ACCEPT' ? options.increment ?? 1 : 0);
      await tx.query('UPDATE test_counters SET counter=$2,version=version+1 WHERE scope_id=$1', [context.scopeId,counter]);
      return { result: { counter }, memoryChanges: options.changes ?? [{ op: 'append_event', id: randomUUID(), payload: { counter }, subjectIds: ['counter'] }] };
    },
  };
}
export function request(scopeId: string, version = 0) { return { scopeId, requestId: randomUUID(), expectedMemoryVersion: version, bindingId: 'counter', bindingVersion: '1', input: { text: 'sample' } as Json }; }
export function barrier() { let release!: () => void; let entered!: () => void; const waiting = new Promise<void>(r => { release = r; }); const ready = new Promise<void>(r => { entered = r; }); return { ready, release, wait: () => { entered(); return waiting; } }; }

