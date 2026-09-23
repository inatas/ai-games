import { randomUUID } from 'node:crypto';
import {
  Harness, HarnessError, canonical, type Binding, type HarnessStore,
  type ModelAdapter, type Transaction,
} from '@game-ai/core';
import {
  acceptDecision, acceptInterrupt, actorView, assertDefinition, assertVersion, createRoom,
  eligibleActors, occupySeat, settleDecisionWindow, spectatorView, validateDecision, validateInterrupt,
} from './engine.ts';
import { migrateTurnBased } from './schema.ts';
import type { Lane, PendingDecision, Room, RoomDefinition, RoomLimits, Seat, SpectatorView } from './types.ts';
import type { DecisionAdapter, DecisionOutput } from './decision.ts';

type Options = { harness?: ConstructorParameters<typeof Harness>[2] };
const inputSchema = {
  type: 'object', additionalProperties: false, required: ['roomId', 'phaseInstance'],
  properties: { roomId: { type: 'string' }, phaseInstance: { type: 'integer', minimum: 1 } },
};

/** Trusted server API. Public callers receive spectate(), never inspect() or Room. */
export class RoomRuntime {
  private models: Map<string, ModelAdapter | DecisionAdapter>;
  private active = new Set<Harness>();
  private ticks = new Set<Promise<SpectatorView>>();
  private runs = new Map<string, Promise<SpectatorView>>();
  private closed = false;
  private now(): number { return this.options.harness?.clock?.now() ?? Date.now(); }
  private startWindow(room: Room, previousInstance: number): void {
    if (room.status !== 'running' || room.phaseInstance === previousInstance || !this.definition.windowMs) return;
    const duration = this.definition.windowMs(room);
    if (!Number.isSafeInteger(duration) || duration < 1) throw new HarnessError('INVALID_WINDOW');
    const actionDuration = this.definition.actionWindowMs?.(room) ?? duration;
    if (!Number.isSafeInteger(actionDuration) || actionDuration < 1 || actionDuration > duration) throw new HarnessError('INVALID_WINDOW');
    room.phaseStartedAt = this.now();
    room.phaseDeadlineAt = room.phaseStartedAt + duration;
    room.phaseActionDeadlineAt = room.phaseStartedAt + actionDuration;
  }

  constructor(
    private store: HarnessStore,
    private definition: RoomDefinition,
    profiles: Readonly<Record<string, ModelAdapter | DecisionAdapter>>,
    private options: Options = {},
  ) {
    assertDefinition(definition);
    this.models = new Map(Object.entries(profiles));
    if (!this.models.size || [...this.models.values()].some(model =>
      typeof (model as ModelAdapter).generate !== 'function' && typeof (model as DecisionAdapter).decide !== 'function')) {
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

  async create(runKey: string, limits: Partial<RoomLimits> = {}, admissionSignature?: string): Promise<Room> {
    if (admissionSignature !== undefined && (!admissionSignature || admissionSignature.length > 200)) throw new HarnessError('INVALID_ADMISSION_SIGNATURE');
    const proposed = createRoom(randomUUID(), runKey, this.definition, limits);
    if (admissionSignature !== undefined) proposed.admissionSignature = admissionSignature;
    return this.store.transaction(async tx => {
      await tx.query('INSERT INTO tb_rooms(id,run_key,document) VALUES($1,$2,$3) ON CONFLICT(run_key) DO NOTHING',
        [proposed.id, runKey, JSON.stringify(proposed)]);
      const row = (await tx.query('SELECT document FROM tb_rooms WHERE run_key=$1', [runKey])).rows[0];
      const existing: Room = row.document;
      assertVersion(existing, this.definition);
      if (canonical(existing.limits) !== canonical(proposed.limits)) throw new HarnessError('IDEMPOTENCY_CONFLICT', 409);
      if (existing.admissionSignature !== proposed.admissionSignature) throw new HarnessError('IDEMPOTENCY_CONFLICT', 409);
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
      this.startWindow(next, room.phaseInstance);
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
      room.decisionEpoch === job.decisionEpoch && !room.pendingJobs[job.lane]?.failedReason &&
      this.now() < (room.phaseActionDeadlineAt ?? room.phaseDeadlineAt ?? Infinity);
  }

  /** One room lock decides all missing actions at the original persisted deadline. */
  private async expireWindow(roomId: string): Promise<void> {
    if (!this.definition.fallbackDecision) return;
    await this.store.transaction(async tx => {
      let room = await this.read(tx, roomId, true);
      if (room.status !== 'running' || room.phaseDeadlineAt === undefined ||
          this.now() < (room.phaseActionDeadlineAt ?? room.phaseDeadlineAt)) return;
      const instance = room.phaseInstance;
      const phaseDeadline = room.phaseDeadlineAt;
      const outstanding = eligibleActors(room);
      if (!outstanding.length && this.now() < phaseDeadline) return;
      const pending = Object.values(room.pendingJobs);
      for (const seat of outstanding) {
        const action = this.definition.fallbackDecision!(room, seat);
        room = acceptDecision(room, instance, seat, action, this.definition);
      }
      if (this.now() >= phaseDeadline && room.status === 'running' && room.phaseInstance === instance &&
          room.phase?.actors.length === room.decisions.length && this.definition.fixedWindow?.(room)) {
        room = settleDecisionWindow(room, this.definition);
      }
      for (const job of pending) {
        if (!job) continue;
        await tx.query('SELECT id FROM fw_scopes WHERE id=$1 FOR UPDATE', [job.scopeId]);
        await tx.query("UPDATE fw_requests SET status='failed',error=$3 WHERE scope_id=$1 AND request_id=$2 AND status='processing'",
          [job.scopeId, job.requestId, JSON.stringify({ code: 'GAME_DEADLINE' })]);
      }
      room.pendingJobs = {};
      this.startWindow(room, instance);
      await this.save(tx, room);
    });
  }

  private async reserve(roomId: string, interruptSeat?: number, ordinarySeat?: number): Promise<{ room: Room; job?: PendingDecision }> {
    return this.store.transaction(async tx => {
      const room = await this.read(tx, roomId, true);
      if (room.status !== 'running') return { room };
      if (this.now() >= (room.phaseActionDeadlineAt ?? room.phaseDeadlineAt ?? Infinity)) return { room };
      const eligible = eligibleActors(room);
      if (interruptSeat === undefined && eligible.length === 0) return { room };
      const actor = interruptSeat ?? ordinarySeat ?? eligible[0];
      if (interruptSeat === undefined && (!eligible.includes(actor) ||
          (ordinarySeat !== undefined && room.phase?.mode !== 'sealed'))) throw new HarnessError('ACTOR_NOT_ELIGIBLE', 409);
      const lane: Lane = interruptSeat !== undefined ? `interrupt:${interruptSeat}`
        : room.phase?.mode === 'sealed' ? `normal:${actor}` : 'normal';
      if (interruptSeat !== undefined && !room.phase?.interrupt?.actors.includes(interruptSeat)) {
        throw new HarnessError('ACTOR_NOT_ELIGIBLE', 409);
      }
      const old = room.pendingJobs[lane];
      if (old?.failedReason) return { room };
      if (old && this.current(room, old)) return { room, job: old };
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
        ...(interruptSeat === undefined && this.definition.decisionSpec
          ? { decisionInput: this.definition.decisionSpec(room, seat.seat) } : {}),
      };
      room.pendingJobs[lane] = job;
      room.requests++;
      await this.save(tx, room);
      return { room, job };
    });
  }

  private binding(snapshot: Room, job: PendingDecision): Binding {
    const interrupt = job.lane.startsWith('interrupt:');
    const validate = interrupt ? validateInterrupt : validateDecision;
    const requirePending = (room: Room) => {
      if (!this.current(room, job)) throw new HarnessError('PHASE_CONFLICT', 409);
    };
    return {
      id: `turn-based.${snapshot.id}`, version: this.definition.version, mode: 'assessment',
      inputSchema, outputSchema: job.decisionInput?.outputSchema ?? (interrupt ? snapshot.phase!.interrupt!.schema : snapshot.phase!.schema),
      lockResources: async (tx, scopeId) => {
        if (scopeId !== job.scopeId) throw new HarnessError('FORBIDDEN', 403);
        await this.read(tx, snapshot.id, true);
      },
      prepare: async (_input, scopeId) => {
        if (scopeId !== job.scopeId) throw new HarnessError('FORBIDDEN', 403);
        requirePending(await this.inspect(snapshot.id));
        return {
          gameVersion: `${job.phaseInstance}:${job.decisionEpoch}`, facts: job.decisionInput?.context ?? job.facts,
          instructions: this.definition.instructions,
          subjectIds: [], tags: [], requiredMemoryIds: [], visibility: [],
        };
      },
      validate: proposal => {
        try {
          const action = this.decode(job, proposal);
          if (action === null) return { ok: false, code: 'INVALID_DECISION' };
          validate(snapshot, job.phaseInstance, job.seat, action, this.definition);
          return { ok: true };
        }
        catch (error) { return { ok: false, code: error instanceof HarnessError ? error.code : 'RULE_FAILED' }; }
      },
      apply: async (tx, proposal, context) => {
        const room = await this.read(tx, snapshot.id, true);
        requirePending(room);
        if (context.requestId !== job.requestId || context.scopeId !== job.scopeId ||
            context.gameVersion !== `${job.phaseInstance}:${job.decisionEpoch}`) throw new HarnessError('PHASE_CONFLICT', 409);
        const accept = interrupt ? acceptInterrupt : acceptDecision;
        const action = this.decode(job, proposal);
        if (action === null) throw new HarnessError('INVALID_DECISION');
        const next = accept(room, job.phaseInstance, job.seat, action, this.definition);
        delete next.pendingJobs[job.lane];
        if (next.phaseInstance !== room.phaseInstance || next.status !== 'running') next.pendingJobs = {};
        this.startWindow(next, room.phaseInstance);
        await this.save(tx, next);
        return {
          result: { roomId: room.id, revision: next.revision },
          memoryChanges: [{
            op: 'append_event', id: job.requestId, visibility: 'internal',
            payload: { roomId: room.id, phaseInstance: job.phaseInstance, lane: job.lane, seat: job.seat, decision: action },
          }],
        };
      },
    };
  }

  private decode(job: PendingDecision, proposal: import('@game-ai/core').Json): import('@game-ai/core').Json | null {
    if (!job.decisionInput) return proposal;
    if (!this.definition.decodeDecision) throw new HarnessError('INVALID_DEFINITION');
    return this.definition.decodeDecision(job.decisionInput, { kind: 'proposal', value: proposal as { selected: string } });
  }

  /** One ordinary decision per call; all callers for the same lane share its durable request. */
  async tick(roomId: string): Promise<SpectatorView> { return this.trackTick(roomId); }
  async tickSealed(roomId: string, seat: number): Promise<SpectatorView> {
    if (!Number.isSafeInteger(seat) || seat <= 0) throw new HarnessError('ACTOR_NOT_ELIGIBLE', 409);
    return this.trackTick(roomId, seat, 'ordinary');
  }
  async tickInterrupt(roomId: string, seat: number): Promise<SpectatorView> {
    if (!Number.isSafeInteger(seat) || seat <= 0) throw new HarnessError('ACTOR_NOT_ELIGIBLE', 409);
    return this.trackTick(roomId, seat);
  }
  private async trackTick(roomId: string, seat?: number, kind: 'ordinary' | 'interrupt' = 'interrupt'): Promise<SpectatorView> {
    if (this.closed) throw new HarnessError('RUNTIME_CLOSED');
    const task = this.tickOnce(roomId, seat, kind);
    this.ticks.add(task);
    try { return await task; } finally { this.ticks.delete(task); }
  }

  private async tickOnce(roomId: string, seat?: number, kind: 'ordinary' | 'interrupt' = 'interrupt'): Promise<SpectatorView> {
    await this.expireWindow(roomId);
    const { room, job } = await this.reserve(roomId, kind === 'interrupt' ? seat : undefined, kind === 'ordinary' ? seat : undefined);
    if (this.closed) throw new HarnessError('RUNTIME_CLOSED');
    if (!job) return spectatorView(room, this.definition);
    const model = this.models.get(job.modelProfile)!;
    if ('decide' in model) return this.runScript(roomId, room, job, model);
    const harness = new Harness(this.store, model, this.options.harness).register(this.binding(room, job));
    this.active.add(harness);
    try {
      await harness.recover();
      // Shutdown may have raced recovery before this Harness acquired a controller.
      if (this.closed) throw new HarnessError('RUNTIME_CLOSED');
      await harness.submit({
        scopeId: job.scopeId, requestId: job.requestId, expectedMemoryVersion: job.memoryVersion,
        ...((room.phaseActionDeadlineAt ?? room.phaseDeadlineAt) === undefined ? {}
          : { notAfter: room.phaseActionDeadlineAt ?? room.phaseDeadlineAt }),
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
            if (this.definition.fallbackDecision && current.phaseDeadlineAt !== undefined) {
              current.pendingJobs[job.lane]!.failedReason = result.error?.code ?? 'DECISION_FAILED';
            } else {
              current.status = 'blocked'; current.error = result.error?.code ?? 'DECISION_FAILED';
            }
            current.revision++;
          } else delete current.pendingJobs[job.lane];
          await this.save(tx, current);
        });
      }
    } catch (error) {
      if (!(error instanceof HarnessError && error.code === 'PHASE_CONFLICT')) throw error;
    } finally { this.active.delete(harness); }
    return this.spectate(roomId);
  }

  private async runScript(roomId: string, snapshot: Room, job: PendingDecision, adapter: DecisionAdapter): Promise<SpectatorView> {
    if (!job.decisionInput || !this.definition.decodeDecision) throw new HarnessError('INVALID_DEFINITION');
    let action: import('@game-ai/core').Json | null = null;
    let reason = 'INVALID_DECISION';
    try {
      const output: DecisionOutput = await adapter.decide(job.decisionInput, new AbortController().signal);
      action = this.definition.decodeDecision(job.decisionInput, output);
      if (output.kind === 'no-valid-input') reason = output.reason;
    } catch { reason = 'DECISION_FAILED'; }
    await this.store.transaction(async tx => {
      const room = await this.read(tx, roomId, true);
      if (!this.current(room, job)) return;
      if (action === null) {
        if (this.definition.fallbackDecision && room.phaseDeadlineAt !== undefined) {
          room.pendingJobs[job.lane]!.failedReason = reason;
          room.revision++;
          await this.save(tx, room);
          return;
        }
        throw new HarnessError(reason);
      }
      let next: Room;
      try { next = acceptDecision(room, job.phaseInstance, job.seat, action, this.definition); }
      catch (error) {
        if (!this.definition.fallbackDecision || room.phaseDeadlineAt === undefined) throw error;
        room.pendingJobs[job.lane]!.failedReason = error instanceof HarnessError ? error.code : 'RULE_REJECTED';
        room.revision++;
        await this.save(tx, room);
        return;
      }
      delete next.pendingJobs[job.lane];
      if (next.phaseInstance !== room.phaseInstance || next.status !== 'running') next.pendingJobs = {};
      this.startWindow(next, room.phaseInstance);
      await this.save(tx, next);
    });
    return this.spectate(snapshot.id);
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
    const dispatch = (lane: Lane, key: string, seat?: number, kind: 'ordinary' | 'interrupt' = 'interrupt') => {
      pending.add(lane);
      void this.trackTick(roomId, seat, kind).catch(error => {
        // A concurrent transition may revoke eligibility between snapshot and reservation.
        if (!(error instanceof HarnessError && ['ACTOR_NOT_ELIGIBLE', 'RUNTIME_CLOSED'].includes(error.code))) failure = error;
      }).finally(() => { pending.delete(lane); last.set(lane, { key, at: Date.now() }); });
    };
    while (!this.closed) {
      if (failure) throw failure;
      const room = await this.inspect(roomId);
      if (room.status !== 'running') return spectatorView(room, this.definition);
      if (this.now() >= (room.phaseActionDeadlineAt ?? room.phaseDeadlineAt ?? Infinity)) {
        await this.expireWindow(roomId);
        const untilEnd = (room.phaseDeadlineAt ?? this.now()) - this.now();
        await new Promise(resolve => setTimeout(resolve, Math.min(1000, Math.max(25, untilEnd))));
        continue;
      }
      const key = `${room.phaseInstance}:${room.events.filter(e => e.audience === 'public').at(-1)?.sequence ?? 0}`;
      if (room.phase?.mode === 'sealed') {
        for (const actor of eligibleActors(room)) {
          const lane: Lane = `normal:${actor}`;
          if (!pending.has(lane)) dispatch(lane, key, actor, 'ordinary');
        }
      } else if (eligibleActors(room).length > 0 && !pending.has('normal')) dispatch('normal', key);
      for (const seat of this.definition.decisionSpec ? [] : room.phase?.interrupt?.actors ?? []) {
        const lane: Lane = `interrupt:${seat}`;
        const previous = last.get(lane);
        if (!pending.has(lane) && (!previous || previous.key !== key || Date.now() - previous.at >= interval)) dispatch(lane, key, seat);
      }
      const idle = eligibleActors(room).length === 0;
      const remaining = (room.phaseDeadlineAt ?? this.now() + interval) - this.now();
      await new Promise(resolve => setTimeout(resolve, idle ? Math.min(1000, Math.max(25, remaining)) : Math.min(25, interval)));
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
