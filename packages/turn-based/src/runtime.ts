import { randomUUID } from 'node:crypto';
import {
  Harness, HarnessError, canonical, type Binding, type HarnessStore,
  type ModelAdapter, type Transaction,
} from '@game-ai/core';
import {
  acceptDecision, acceptInterrupt, actorView, assertDefinition, assertVersion, createRoom,
  eligibleActors, occupySeat, spectatorView, validateDecision, validateInterrupt,
} from './engine.ts';
import { migrateTurnBased } from './schema.ts';
import type { Lane, PendingDecision, Room, RoomDefinition, RoomLimits, Seat, SpectatorView } from './types.ts';

type Options = { harness?: ConstructorParameters<typeof Harness>[2] };
const inputSchema = {
  type: 'object', additionalProperties: false, required: ['roomId', 'phaseInstance'],
  properties: { roomId: { type: 'string' }, phaseInstance: { type: 'integer', minimum: 1 } },
};

/** Trusted server API. Public callers receive spectate(), never inspect() or Room. */
export class RoomRuntime {
  private models: Map<string, ModelAdapter>;
  private active = new Set<Harness>();
  private ticks = new Set<Promise<SpectatorView>>();
  private runs = new Map<string, Promise<SpectatorView>>();
  private closed = false;

  constructor(
    private store: HarnessStore,
    private definition: RoomDefinition,
    profiles: Readonly<Record<string, ModelAdapter>>,
    private options: Options = {},
  ) {
    assertDefinition(definition);
    this.models = new Map(Object.entries(profiles));
    if (!this.models.size || [...this.models.values()].some(model => typeof model?.generate !== 'function')) {
      throw new HarnessError('INVALID_MODELS');
    }
  }

  async migrate(): Promise<void> { await this.store.transaction(migrateTurnBased); }

  private async read(tx: Transaction, id: string, lock = false): Promise<Room> {
    const row = (await tx.query(`SELECT document FROM tb_rooms WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [id])).rows[0];
    if (!row) throw new HarnessError('ROOM_NOT_FOUND', 404);
    const room: Room = row.document;
    assertVersion(room, this.definition);
    return room;
  }
  private async save(tx: Transaction, room: Room): Promise<void> {
    await tx.query('UPDATE tb_rooms SET document=$2 WHERE id=$1', [room.id, JSON.stringify(room)]);
  }

  async create(runKey: string, limits: Partial<RoomLimits> = {}): Promise<Room> {
    const proposed = createRoom(randomUUID(), runKey, this.definition, limits);
    return this.store.transaction(async tx => {
      await tx.query('INSERT INTO tb_rooms(id,run_key,document) VALUES($1,$2,$3) ON CONFLICT(run_key) DO NOTHING',
        [proposed.id, runKey, JSON.stringify(proposed)]);
      const row = (await tx.query('SELECT document FROM tb_rooms WHERE run_key=$1', [runKey])).rows[0];
      const existing: Room = row.document;
      assertVersion(existing, this.definition);
      if (canonical(existing.limits) !== canonical(proposed.limits)) throw new HarnessError('IDEMPOTENCY_CONFLICT', 409);
      return existing;
    });
  }

  async seat(roomId: string, config: Omit<Seat, 'scopeId' | 'interruptScopeId'>): Promise<Room> {
    if (!this.models.has(config.modelProfile)) throw new HarnessError('UNKNOWN_MODEL');
    return this.store.transaction(async tx => {
      const room = await this.read(tx, roomId, true);
      const existing = room.seats.find(s => s.seat === config.seat);
      const scopeId = existing?.scopeId ?? randomUUID();
      const interruptScopeId = existing?.interruptScopeId ?? randomUUID();
      const next = occupySeat(room, { ...config, scopeId, interruptScopeId }, this.definition);
      if (!existing) {
        await tx.query('INSERT INTO fw_scopes(id) VALUES($1),($2)', [scopeId, interruptScopeId]);
        await tx.query('INSERT INTO tb_seats(room_id,seat,scope_id,interrupt_scope_id) VALUES($1,$2,$3,$4)',
          [roomId, config.seat, scopeId, interruptScopeId]);
        await this.save(tx, next);
      }
      return next;
    });
  }

  async inspect(roomId: string): Promise<Room> { return this.read(this.store.pool, roomId); }
  async spectate(roomId: string): Promise<SpectatorView> {
    return spectatorView(await this.inspect(roomId), this.definition);
  }

  private current(room: Room, job: PendingDecision): boolean {
    return room.status === 'running' && room.pendingJobs[job.lane]?.requestId === job.requestId &&
      room.pendingJobs[job.lane]?.scopeId === job.scopeId && room.phaseInstance === job.phaseInstance &&
      room.decisionEpoch === job.decisionEpoch;
  }

  private async reserve(roomId: string, interruptSeat?: number): Promise<{ room: Room; job?: PendingDecision }> {
    return this.store.transaction(async tx => {
      const room = await this.read(tx, roomId, true);
      if (room.status !== 'running') return { room };
      const lane: Lane = interruptSeat === undefined ? 'normal' : `interrupt:${interruptSeat}`;
      if (interruptSeat !== undefined && !room.phase?.interrupt?.actors.includes(interruptSeat)) {
        throw new HarnessError('ACTOR_NOT_ELIGIBLE', 409);
      }
      const old = room.pendingJobs[lane];
      if (old && this.current(room, old)) return { room, job: old };
      const actor = interruptSeat ?? eligibleActors(room)[0];
      const seat = room.seats.find(s => s.seat === actor);
      if (!seat) throw new HarnessError('INVALID_PHASE');
      if (!this.models.has(seat.modelProfile)) throw new HarnessError('UNKNOWN_MODEL');
      const scopeId = interruptSeat === undefined ? seat.scopeId : seat.interruptScopeId;
      const scope = (await tx.query('SELECT memory_version FROM fw_scopes WHERE id=$1 FOR UPDATE', [scopeId])).rows[0];
      if (!scope) throw new HarnessError('SCOPE_NOT_FOUND');
      // Retain active Harness leases even when the corresponding game proposal is superseded.
      const now = this.options.harness?.clock?.now() ?? Date.now();
      await tx.query("UPDATE fw_requests SET status='failed',error=$3 WHERE scope_id=$1 AND status='processing' AND lease_expires_at<=$2",
        [scopeId, now, JSON.stringify({ code: 'PROCESSING_EXPIRED' })]);
      if ((await tx.query("SELECT 1 FROM fw_requests WHERE scope_id=$1 AND status='processing'", [scopeId])).rowCount) return { room };
      if (room.requests >= room.limits.maxRequests) {
        room.status = 'aborted'; room.error = 'REQUEST_BUDGET_EXCEEDED'; room.revision++;
        await this.save(tx, room); return { room };
      }
      const job: PendingDecision = {
        lane, requestId: randomUUID(), scopeId, seat: seat.seat,
        modelProfile: seat.modelProfile, memoryVersion: scope.memory_version,
        phaseInstance: room.phaseInstance, decisionEpoch: room.decisionEpoch,
        facts: actorView(room, seat.seat, this.definition),
      };
      room.pendingJobs[lane] = job;
      room.requests++;
      await this.save(tx, room);
      return { room, job };
    });
  }

  private binding(snapshot: Room, job: PendingDecision): Binding {
    const interrupt = job.lane !== 'normal';
    const validate = interrupt ? validateInterrupt : validateDecision;
    const requirePending = (room: Room) => {
      if (!this.current(room, job)) throw new HarnessError('PHASE_CONFLICT', 409);
    };
    return {
      id: `turn-based.${snapshot.id}`, version: this.definition.version, mode: 'assessment',
      inputSchema, outputSchema: interrupt ? snapshot.phase!.interrupt!.schema : snapshot.phase!.schema,
      lockResources: async (tx, scopeId) => {
        if (scopeId !== job.scopeId) throw new HarnessError('FORBIDDEN', 403);
        await this.read(tx, snapshot.id, true);
      },
      prepare: async (_input, scopeId) => {
        if (scopeId !== job.scopeId) throw new HarnessError('FORBIDDEN', 403);
        requirePending(await this.inspect(snapshot.id));
        return {
          gameVersion: `${job.phaseInstance}:${job.decisionEpoch}`, facts: job.facts,
          instructions: this.definition.instructions,
          subjectIds: [], tags: [], requiredMemoryIds: [], visibility: [],
        };
      },
      validate: proposal => {
        try { validate(snapshot, job.phaseInstance, job.seat, proposal, this.definition); return { ok: true }; }
        catch (error) { return { ok: false, code: error instanceof HarnessError ? error.code : 'RULE_FAILED' }; }
      },
      apply: async (tx, proposal, context) => {
        const room = await this.read(tx, snapshot.id, true);
        requirePending(room);
        if (context.requestId !== job.requestId || context.scopeId !== job.scopeId ||
            context.gameVersion !== `${job.phaseInstance}:${job.decisionEpoch}`) throw new HarnessError('PHASE_CONFLICT', 409);
        const accept = interrupt ? acceptInterrupt : acceptDecision;
        const next = accept(room, job.phaseInstance, job.seat, proposal, this.definition);
        delete next.pendingJobs[job.lane];
        await this.save(tx, next);
        return {
          result: { roomId: room.id, revision: next.revision },
          memoryChanges: [{
            op: 'append_event', id: job.requestId, visibility: 'internal',
            payload: { roomId: room.id, phaseInstance: job.phaseInstance, lane: job.lane, seat: job.seat, decision: proposal },
          }],
        };
      },
    };
  }

  /** One ordinary decision per call; all callers for the same lane share its durable request. */
  async tick(roomId: string): Promise<SpectatorView> { return this.trackTick(roomId); }
  async tickInterrupt(roomId: string, seat: number): Promise<SpectatorView> {
    if (!Number.isSafeInteger(seat) || seat <= 0) throw new HarnessError('ACTOR_NOT_ELIGIBLE', 409);
    return this.trackTick(roomId, seat);
  }
  private async trackTick(roomId: string, seat?: number): Promise<SpectatorView> {
    if (this.closed) throw new HarnessError('RUNTIME_CLOSED');
    const task = this.tickOnce(roomId, seat);
    this.ticks.add(task);
    try { return await task; } finally { this.ticks.delete(task); }
  }

  private async tickOnce(roomId: string, seat?: number): Promise<SpectatorView> {
    const { room, job } = await this.reserve(roomId, seat);
    if (this.closed) throw new HarnessError('RUNTIME_CLOSED');
    if (!job) return spectatorView(room, this.definition);
    const model = this.models.get(job.modelProfile)!;
    const harness = new Harness(this.store, model, this.options.harness).register(this.binding(room, job));
    this.active.add(harness);
    try {
      await harness.recover();
      // Shutdown may have raced recovery before this Harness acquired a controller.
      if (this.closed) throw new HarnessError('RUNTIME_CLOSED');
      await harness.submit({
        scopeId: job.scopeId, requestId: job.requestId, expectedMemoryVersion: job.memoryVersion,
        bindingId: `turn-based.${room.id}`, bindingVersion: this.definition.version,
        input: { roomId: room.id, phaseInstance: job.phaseInstance },
      }, async tx => {
        if (!this.current(await this.read(tx, room.id, true), job)) throw new HarnessError('PHASE_CONFLICT', 409);
      });
      if (this.closed) await harness.close();
      await harness.drain();
      const result = await harness.get(job.scopeId, job.requestId);
      if (result.status === 'failed' || result.status === 'rejected') {
        await this.store.transaction(async tx => {
          const current = await this.read(tx, roomId, true);
          if (current.pendingJobs[job.lane]?.requestId !== job.requestId) return;
          if (this.current(current, job)) {
            current.status = 'blocked'; current.error = result.error?.code ?? 'DECISION_FAILED'; current.revision++;
          } else delete current.pendingJobs[job.lane];
          await this.save(tx, current);
        });
      }
    } catch (error) {
      if (!(error instanceof HarnessError && error.code === 'PHASE_CONFLICT')) throw error;
    } finally { this.active.delete(harness); }
    return this.spectate(roomId);
  }

  /** Opt-in trusted host scheduler; no automatic application startup or network retry. */
  async run(roomId: string, options: { interruptIntervalMs?: number } = {}): Promise<SpectatorView> {
    if (this.closed) throw new HarnessError('RUNTIME_CLOSED');
    const interval = options.interruptIntervalMs ?? 1000;
    if (!Number.isSafeInteger(interval) || interval < 1) throw new HarnessError('INVALID_INTERVAL');
    const existing = this.runs.get(roomId);
    if (existing) return existing;
    const task = this.schedule(roomId, interval);
    this.runs.set(roomId, task);
    try { return await task; } finally { this.runs.delete(roomId); }
  }

  private async schedule(roomId: string, interval: number): Promise<SpectatorView> {
    const pending = new Set<Lane>();
    const last = new Map<Lane, { key: string; at: number }>();
    let failure: unknown;
    const dispatch = (lane: Lane, key: string, seat?: number) => {
      pending.add(lane);
      void this.trackTick(roomId, seat).catch(error => {
        // A concurrent transition may revoke eligibility between snapshot and reservation.
        if (!(error instanceof HarnessError && ['ACTOR_NOT_ELIGIBLE', 'RUNTIME_CLOSED'].includes(error.code))) failure = error;
      }).finally(() => { pending.delete(lane); last.set(lane, { key, at: Date.now() }); });
    };
    while (!this.closed) {
      if (failure) throw failure;
      const room = await this.inspect(roomId);
      if (room.status !== 'running') return spectatorView(room, this.definition);
      const key = `${room.phaseInstance}:${room.events.filter(e => e.audience === 'public').at(-1)?.sequence ?? 0}`;
      if (!pending.has('normal')) dispatch('normal', key);
      for (const seat of room.phase?.interrupt?.actors ?? []) {
        const lane: Lane = `interrupt:${seat}`;
        const previous = last.get(lane);
        if (!pending.has(lane) && (!previous || previous.key !== key || Date.now() - previous.at >= interval)) dispatch(lane, key, seat);
      }
      await new Promise(resolve => setTimeout(resolve, Math.min(25, interval)));
    }
    return this.spectate(roomId);
  }

  /** Explicit host action. Superseded processing leases remain owned by Harness. */
  async resume(roomId: string): Promise<Room> {
    return this.store.transaction(async tx => {
      const room = await this.read(tx, roomId, true);
      if (room.status !== 'blocked') throw new HarnessError('ROOM_NOT_BLOCKED', 409);
      room.status = 'running'; room.pendingJobs = {}; room.decisionEpoch++; room.error = null; room.revision++;
      await this.save(tx, room);
      return room;
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    await Promise.all([...this.active].map(harness => harness.close()));
    await Promise.allSettled([...this.ticks, ...this.runs.values()]);
  }
}
