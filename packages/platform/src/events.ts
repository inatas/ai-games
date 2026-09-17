import { createHash, randomUUID } from 'node:crypto';
import { Ajv, type ValidateFunction } from 'ajv';
import { HarnessError, type Json, type Transaction } from '@game-ai/core';

export interface EventSubject { kind: string; id: string }
export interface FactEvent {
  eventId: string; realmId: string; type: string; actor: EventSubject; requestId: string;
  causationId: string | null; chainDepth: number; contentVersion: string; payload: Json; createdAt: number;
}
export interface EventAudience { consumerId: string; recipient: EventSubject }
export interface EventDelivery {
  id: string; event: FactEvent; consumerId: string; recipient: EventSubject;
  attempt: number; leaseUntil: number;
}
export interface EventConsumer {
  id: string; types: string[];
  /** Optional external work. Use delivery.id as the single downstream requestId. Never retry a terminal model result. */
  prepare?(delivery: EventDelivery): Promise<Json>;
  /** Database-only work; changes and delivery completion share a transaction. */
  apply(tx: Transaction, delivery: EventDelivery, prepared: Json): Promise<void>;
}
export interface EventStore {
  transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>;
}
export interface EventOptions {
  now?: () => number; leaseMs?: number;
  validateSubject?: (tx: Transaction, realmId: string, subject: EventSubject) => Promise<boolean>;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class EventRuntime {
  private readonly types = new Map<string, ValidateFunction>();
  private readonly consumers = new Map<string, EventConsumer>();
  private readonly ajv = new Ajv({ strict: true, allErrors: true });
  private readonly now: () => number;
  private readonly leaseMs: number;
  constructor(private readonly store: EventStore, private readonly options: EventOptions = {}) {
    this.now = options.now ?? Date.now;
    this.leaseMs = options.leaseMs ?? 90000;
    if (!Number.isSafeInteger(this.leaseMs) || this.leaseMs <= 0) throw Error('INVALID_EVENT_LEASE');
  }
  registerType(type: string, schema: object) {
    if (!type || this.types.has(type)) throw Error('DUPLICATE_EVENT_TYPE');
    this.types.set(type, this.ajv.compile(schema));
  }
  registerConsumer(consumer: EventConsumer) {
    if (!consumer.id || this.consumers.has(consumer.id) || !consumer.types.length || consumer.types.some(t => !this.types.has(t))) throw Error('INVALID_EVENT_CONSUMER');
    this.consumers.set(consumer.id, consumer);
  }
  private async validSubject(tx: Transaction, realmId: string, subject: EventSubject) {
    if (!subject || typeof subject.id !== 'string' || !subject.id) return false;
    if (subject.kind === 'character') {
      if (!uuid.test(subject.id)) return false;
      return !!(await tx.query('SELECT 1 FROM mud_characters WHERE scope_id=$1 AND realm_id=$2 AND active', [subject.id, realmId])).rowCount;
    }
    return this.options.validateSubject ? this.options.validateSubject(tx, realmId, subject) : false;
  }
  async append(tx: Transaction, event: FactEvent, audience: EventAudience[] = []) {
    if (!Number.isInteger(event.chainDepth) || event.chainDepth < 0 || event.chainDepth > 4) throw new HarnessError('EVENT_CHAIN_LIMIT');
    if (!uuid.test(event.eventId) || !uuid.test(event.requestId) || !Number.isSafeInteger(event.createdAt) || !this.types.get(event.type)?.(event.payload) || Buffer.byteLength(canonical(event)) > 32768) throw new HarnessError('INVALID_EVENT');
    const realm = (await tx.query('SELECT content_version FROM mud_realms WHERE id=$1 FOR UPDATE', [event.realmId])).rows[0];
    if (!realm || realm.content_version !== event.contentVersion || !await this.validSubject(tx, event.realmId, event.actor)) throw new HarnessError('INVALID_EVENT_ACTOR');
    if (event.causationId) {
      if (!uuid.test(event.causationId)) throw new HarnessError('INVALID_CAUSATION');
      const parent = (await tx.query('SELECT realm_id,chain_depth FROM platform_events WHERE id=$1', [event.causationId])).rows[0];
      if (!parent || parent.realm_id !== event.realmId || event.chainDepth !== parent.chain_depth + 1) throw new HarnessError('INVALID_CAUSATION');
    } else if (event.chainDepth !== 0) throw new HarnessError('INVALID_CAUSATION');
    const targets = [...new Map(audience.map(a => [canonical(a), a])).values()].sort((a, b) => canonical(a).localeCompare(canonical(b)));
    if (targets.length > 1000) throw new HarnessError('INVALID_RECIPIENT');
    for (const target of targets) {
      if (!this.consumers.get(target.consumerId)?.types.includes(event.type) || !await this.validSubject(tx, event.realmId, target.recipient)) throw new HarnessError('INVALID_RECIPIENT');
    }
    const hash = createHash('sha256').update(canonical({ event, targets })).digest('hex');
    const inserted = await tx.query(`INSERT INTO platform_events(id,realm_id,type,actor,request_id,causation_id,chain_depth,content_version,payload,created_at,hash)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(id) DO NOTHING RETURNING id`,
    [event.eventId, event.realmId, event.type, JSON.stringify(event.actor), event.requestId, event.causationId, event.chainDepth, event.contentVersion, JSON.stringify(event.payload), event.createdAt, hash]);
    if (!inserted.rowCount) {
      if ((await tx.query('SELECT hash FROM platform_events WHERE id=$1', [event.eventId])).rows[0].hash !== hash) throw new HarnessError('IDEMPOTENCY_CONFLICT', 409);
      return;
    }
    for (const target of targets) await tx.query(`INSERT INTO platform_event_deliveries(id,event_id,consumer_id,recipient_kind,recipient_id,next_attempt_at)
      VALUES($1,$2,$3,$4,$5,$6)`, [randomUUID(), event.eventId, target.consumerId, target.recipient.kind, target.recipient.id, this.now()]);
  }
  async claim(limit = 20): Promise<EventDelivery[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw Error('INVALID_EVENT_BATCH');
    return this.store.transaction(async tx => {
      const now = this.now();
      await tx.query("UPDATE platform_event_deliveries SET status='failed',error_code='DELIVERY_EXHAUSTED' WHERE status='processing' AND lease_until<=$1 AND attempts>=3", [now]);
      const claimed = await tx.query(`WITH candidates AS (
        SELECT id FROM platform_event_deliveries WHERE attempts<3 AND
        ((status='pending' AND next_attempt_at<=$1) OR (status='processing' AND lease_until<=$1))
        ORDER BY next_attempt_at,id LIMIT $2 FOR UPDATE SKIP LOCKED)
        UPDATE platform_event_deliveries d SET status='processing',attempts=attempts+1,lease_until=$3
        FROM candidates c WHERE d.id=c.id RETURNING d.*`, [now, limit, now + this.leaseMs]);
      const result: EventDelivery[] = [];
      for (const row of claimed.rows) {
        const e = (await tx.query('SELECT * FROM platform_events WHERE id=$1', [row.event_id])).rows[0];
        result.push({ id: row.id, consumerId: row.consumer_id, recipient: { kind: row.recipient_kind, id: row.recipient_id }, attempt: row.attempts, leaseUntil: Number(row.lease_until),
          event: { eventId: e.id, realmId: e.realm_id, type: e.type, actor: e.actor, requestId: e.request_id, causationId: e.causation_id, chainDepth: e.chain_depth, contentVersion: e.content_version, payload: e.payload, createdAt: Number(e.created_at) } });
      }
      return result;
    });
  }
  async process(delivery: EventDelivery) {
    const consumer = this.consumers.get(delivery.consumerId);
    const current = async (tx: Transaction) => {
      await tx.query('SELECT id FROM mud_realms WHERE id=$1 FOR UPDATE', [delivery.event.realmId]);
      const row = (await tx.query('SELECT status,attempts,lease_until FROM platform_event_deliveries WHERE id=$1 FOR UPDATE', [delivery.id])).rows[0];
      return row?.status === 'processing' && row.attempts === delivery.attempt && Number(row.lease_until) > this.now();
    };
    try {
      const eligible = await this.store.transaction(async tx => {
        if (!await current(tx)) return false;
        if (!consumer || !await this.validSubject(tx, delivery.event.realmId, delivery.recipient)) {
          await tx.query("UPDATE platform_event_deliveries SET status='failed',error_code='INVALID_RECIPIENT' WHERE id=$1", [delivery.id]);
          return false;
        }
        return true;
      });
      if (!eligible) return;
      const prepared = await consumer!.prepare?.(delivery) ?? null;
      await this.store.transaction(async tx => {
        if (!await current(tx)) return;
        if (!await this.validSubject(tx, delivery.event.realmId, delivery.recipient)) throw new HarnessError('INVALID_RECIPIENT');
        await consumer!.apply(tx, delivery, prepared);
        if (this.now() >= delivery.leaseUntil) throw new HarnessError('DELIVERY_EXPIRED');
        await tx.query("UPDATE platform_event_deliveries SET status='done',error_code=NULL WHERE id=$1", [delivery.id]);
      });
    } catch (error) {
      await this.store.transaction(async tx => {
        if (!await current(tx)) return;
        const code = error instanceof HarnessError ? error.code : 'CONSUMER_FAILED';
        const terminal = delivery.attempt >= 3 || ['INVALID_RECIPIENT', 'EVENT_CHAIN_LIMIT', 'MODEL_UNAVAILABLE', 'MODEL_TIMEOUT', 'MODEL_INVALID_OUTPUT'].includes(code);
        await tx.query('UPDATE platform_event_deliveries SET status=$2,error_code=$3,next_attempt_at=$4 WHERE id=$1', [delivery.id, terminal ? 'failed' : 'pending', code, this.now() + 1000]);
      });
    }
  }
  async tick() { for (const delivery of await this.claim()) await this.process(delivery); }
}
