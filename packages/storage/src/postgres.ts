import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { HarnessError, type MemoryChange, type MemoryRecord, type Transaction, type Visibility, type Worldview } from '@game-ai/core';

export class PostgresStore {
  constructor(public pool: pg.Pool) {}
  async transaction<T>(fn: (tx: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async migrate() {
    await this.transaction(async tx => {
      await tx.query("SELECT pg_advisory_xact_lock(7310251)");
      await tx.query(`
        CREATE TABLE IF NOT EXISTS fw_worldviews (world_id text NOT NULL, version text NOT NULL, content text NOT NULL, digest text NOT NULL, PRIMARY KEY(world_id,version));
        CREATE TABLE IF NOT EXISTS fw_scopes (id uuid PRIMARY KEY, memory_version integer NOT NULL DEFAULT 0, sequence integer NOT NULL DEFAULT 0,
          world_id text, world_version text,
          CONSTRAINT fw_scope_worldview_fk FOREIGN KEY(world_id,world_version) REFERENCES fw_worldviews(world_id,version) MATCH FULL);
        CREATE TABLE IF NOT EXISTS fw_requests (
          scope_id uuid REFERENCES fw_scopes(id), request_id uuid, hash text NOT NULL,
          binding_id text NOT NULL, binding_version text NOT NULL, mode text NOT NULL,
          status text NOT NULL CHECK(status IN ('processing','committed','rejected','failed')),
          lease_expires_at bigint NOT NULL, input jsonb NOT NULL, proposal jsonb, result jsonb,
          error jsonb, memory_version integer, PRIMARY KEY(scope_id,request_id));
        CREATE UNIQUE INDEX IF NOT EXISTS fw_one_processing ON fw_requests(scope_id) WHERE status='processing';
        CREATE TABLE IF NOT EXISTS fw_memory (
          scope_id uuid REFERENCES fw_scopes(id), id text NOT NULL, kind text NOT NULL CHECK(kind IN ('fact','event','summary','item')),
          key text, payload jsonb NOT NULL, source_version text, source_ids text[] NOT NULL DEFAULT '{}',
          subject_ids text[] NOT NULL DEFAULT '{}', tags text[] NOT NULL DEFAULT '{}',
          importance integer NOT NULL DEFAULT 1 CHECK(importance BETWEEN 0 AND 3),
          visibility text NOT NULL CHECK(visibility IN ('public','internal')), status text,
          sequence integer NOT NULL, PRIMARY KEY(scope_id,id), UNIQUE(scope_id,sequence));
        CREATE UNIQUE INDEX IF NOT EXISTS fw_fact_key ON fw_memory(scope_id,key) WHERE kind='fact';
        CREATE INDEX IF NOT EXISTS fw_memory_rank ON fw_memory(scope_id,visibility,importance DESC,sequence DESC);
        CREATE TABLE IF NOT EXISTS fw_model_calls (
          scope_id uuid, request_id uuid, attempt integer, model text NOT NULL, usage jsonb,
          latency_ms integer NOT NULL, context_ids text[] NOT NULL, error_code text,
          world_id text, world_version text, world_digest text,
          PRIMARY KEY(scope_id,request_id,attempt), FOREIGN KEY(scope_id,request_id) REFERENCES fw_requests(scope_id,request_id));
      `);
      await tx.query(`
        CREATE TABLE IF NOT EXISTS fw_users (
          id uuid PRIMARY KEY, username text UNIQUE NOT NULL, password_salt text NOT NULL, password_hash text NOT NULL,
          current_scope_id uuid UNIQUE NOT NULL REFERENCES fw_scopes(id));
        CREATE TABLE IF NOT EXISTS fw_sessions (token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES fw_users(id), expires_at bigint NOT NULL);
        CREATE INDEX IF NOT EXISTS fw_sessions_expiry ON fw_sessions(expires_at);
        CREATE TABLE IF NOT EXISTS fw_game_resets (user_id uuid REFERENCES fw_users(id), request_id uuid, old_scope_id uuid NOT NULL REFERENCES fw_scopes(id), new_scope_id uuid NOT NULL REFERENCES fw_scopes(id), PRIMARY KEY(user_id,request_id));
        CREATE TABLE IF NOT EXISTS fw_login_limits (key text PRIMARY KEY, window_start bigint NOT NULL, attempts integer NOT NULL);
      `);
    });
  }
  async createScope(id = randomUUID()) { await this.pool.query('INSERT INTO fw_scopes(id) VALUES($1)', [id]); return id; }
  async registerWorldview(world: Worldview) {
    await this.transaction(async tx => {
      await tx.query('INSERT INTO fw_worldviews(world_id,version,content,digest) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [world.worldId, world.version, world.content, world.digest]);
      const row = (await tx.query('SELECT digest,content FROM fw_worldviews WHERE world_id=$1 AND version=$2', [world.worldId, world.version])).rows[0];
      if (row.digest !== world.digest || row.content !== world.content) throw new Error('WORLDVIEW_VERSION_CONFLICT');
    });
  }
  async worldview(scopeId: string): Promise<Worldview | undefined> {
    const row = (await this.pool.query('SELECT w.* FROM fw_scopes s JOIN fw_worldviews w ON w.world_id=s.world_id AND w.version=s.world_version WHERE s.id=$1', [scopeId])).rows[0];
    return row ? { worldId: row.world_id, version: row.version, content: row.content, digest: row.digest } : undefined;
  }
  async memory(scopeId: string, visibility: Visibility[] = ['public'], tx: Transaction = this.pool): Promise<MemoryRecord[]> {
    const { rows } = await tx.query('SELECT * FROM fw_memory WHERE scope_id=$1 AND visibility=ANY($2::text[]) ORDER BY sequence', [scopeId, visibility]);
    const ids = new Set(rows.map(r => r.id));
    return rows.map(r => this.mapRecord(r, r.source_ids.filter((id: string) => ids.has(id))));
  }
  private mapRecord(r: any, sources = r.source_ids): MemoryRecord {
    return { id: r.id, kind: r.kind, payload: r.payload, key: r.key, sourceVersion: r.source_version,
      sourceIds: sources, visibility: r.visibility, importance: r.importance, sequence: r.sequence, status: r.status };
  }
  async contextMemory(scopeId: string, visibility: Visibility[], requiredIds: string[], subjects: string[], tags: string[]) {
    const required: MemoryRecord[] = [];
    const visited = new Set<string>();
    const queue = [...requiredIds];
    while (queue.length) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      if (visited.size >= 100) throw new HarnessError('CONTEXT_TOO_LARGE');
      visited.add(id);
      const { rows } = await this.pool.query('SELECT * FROM fw_memory WHERE scope_id=$1 AND id=$2 AND visibility=ANY($3::text[])', [scopeId, id, visibility]);
      if (!rows.length) throw new HarnessError('INVALID_INPUT');
      required.push(this.mapRecord(rows[0])); queue.push(...rows[0].source_ids);
    }
    const { rows } = await this.pool.query(`SELECT * FROM fw_memory WHERE scope_id=$1 AND visibility=ANY($2::text[])
      AND (subject_ids && $3::text[] OR tags && $4::text[] OR importance=3)
      ORDER BY importance DESC,sequence DESC,id LIMIT 100`, [scopeId, visibility, subjects, tags]);
    // Optional records with hidden provenance are not supplied to the model.
    const optional: MemoryRecord[] = [];
    for (const row of rows) {
      const refs = await this.pool.query('SELECT id FROM fw_memory WHERE scope_id=$1 AND id=ANY($2::text[]) AND visibility=ANY($3::text[])', [scopeId, row.source_ids, visibility]);
      optional.push(this.mapRecord(row, refs.rows.map(r => r.id)));
    }
    return { required, optional };
  }
  async applyMemory(tx: Transaction, scopeId: string, changes: MemoryChange[]) {
    if (!Array.isArray(changes) || changes.length > 100 || Buffer.byteLength(JSON.stringify(changes)) > 128 * 1024) throw new HarnessError('INTERNAL_ERROR');
    const existing = await tx.query('SELECT * FROM fw_memory WHERE scope_id=$1', [scopeId]);
    const records = new Map(existing.rows.map(r => [r.id, r]));
    const newIds = new Set<string>();
    for (const c of changes) {
      if (!c || !['replace_fact', 'append_event', 'append_summary', 'open_item', 'close_item'].includes(c.op)) throw new HarnessError('INTERNAL_ERROR');
      if (c.op !== 'replace_fact' && c.op !== 'close_item') {
        if (!c.id || c.id.length > 100 || records.has(c.id) || newIds.has(c.id)) throw new HarnessError('INTERNAL_ERROR');
        newIds.add(c.id);
      }
    }
    // Sources are committed events only, including events in this batch (no cycles).
    const eventIds = new Map(existing.rows.filter(r => r.kind === 'event').map(r => [r.id, r.visibility]));
    changes.forEach(c => { if (c.op === 'append_event') eventIds.set(c.id, c.visibility ?? 'public'); });
    const graph = new Map<string, string[]>();
    changes.forEach(c => { if (c.op === 'append_event') graph.set(c.id, c.sourceIds ?? []); });
    const walk = (id: string, path: Set<string>) => {
      if (path.has(id)) throw new HarnessError('INTERNAL_ERROR');
      for (const source of graph.get(id) ?? []) walk(source, new Set([...path, id]));
    };
    for (const id of graph.keys()) walk(id, new Set());
    for (const c of changes) {
      if (c.op === 'close_item') {
        const result = await tx.query("UPDATE fw_memory SET status='closed' WHERE scope_id=$1 AND id=$2 AND kind='item' AND status='open'", [scopeId, c.id]);
        if (!result.rowCount) throw new HarnessError('RULE_REJECTED', 409, 'ITEM_NOT_OPEN');
        continue;
      }
      const visibility = c.visibility ?? 'public';
      if (!['public','internal'].includes(visibility)) throw new HarnessError('INTERNAL_ERROR');
      const sources = c.op === 'replace_fact' ? [] : c.sourceIds ?? [];
      if (sources.some(id => !eventIds.has(id) || (visibility === 'public' && eventIds.get(id) !== 'public'))) throw new HarnessError('INTERNAL_ERROR');
      if (c.op === 'replace_fact') {
        if (!c.key || c.key.length > 100) throw new HarnessError('INTERNAL_ERROR');
        const old = existing.rows.find(r => r.kind === 'fact' && r.key === c.key);
        if (old) {
          await tx.query('UPDATE fw_memory SET payload=$3,source_version=$4,visibility=$5 WHERE scope_id=$1 AND id=$2', [scopeId, old.id, JSON.stringify(c.payload), c.sourceVersion, visibility]);
          continue;
        }
      }
      const seq = await tx.query('UPDATE fw_scopes SET sequence=sequence+1 WHERE id=$1 RETURNING sequence', [scopeId]);
      const fact = c.op === 'replace_fact';
      const kind = fact ? 'fact' : c.op === 'append_event' ? 'event' : c.op === 'append_summary' ? 'summary' : 'item';
      await tx.query(`INSERT INTO fw_memory(scope_id,id,kind,key,payload,source_version,source_ids,subject_ids,tags,importance,visibility,status,sequence)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [scopeId, fact ? randomUUID() : c.id, kind, fact ? c.key : null, JSON.stringify(c.payload), c.sourceVersion ?? null, sources,
          fact ? [] : c.subjectIds ?? [], fact ? [] : c.tags ?? [], fact ? 1 : c.importance ?? 1, visibility, kind === 'item' ? 'open' : null, seq.rows[0].sequence]);
    }
  }
}

