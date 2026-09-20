import { randomUUID } from 'node:crypto';
import {
  Harness, HarnessError, canonical, type Binding, type HarnessStore,
  type ModelAdapter, type Transaction,
} from '@game-ai/core';
import {
  acceptDecision, actorView, assertDefinition, assertVersion, createRoom,
  eligibleActors, occupySeat, spectatorView, validateDecision,
} from './engine.ts';
import { migrateTurnBased } from './schema.ts';
import type { PendingDecision, Room, RoomDefinition, RoomLimits, Seat, SpectatorView } from './types.ts';

type Options = { harness?: ConstructorParameters<typeof Harness>[2] };
const inputSchema = {
  type: 'object', additionalProperties: false, required: ['roomId', 'phaseInstance'],
  properties: { roomId: { type: 'string' }, phaseInstance: { type: 'integer', minimum: 1 } },
};

/** Trusted server API. Public callers must receive spectate(), never inspect() or Room. */
export class RoomRuntime {
  private models: Map<string, ModelAdapter>;
  private active = new Set<Harness>();
  private ticks = new Set<Promise<SpectatorView>>();
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

  async seat(roomId: string, config: Omit<Seat, 'scopeId'>): Promise<Room> {
    if (!this.models.has(config.modelProfile)) throw new HarnessError('UNKNOWN_MODEL');
    return this.store.transaction(async tx => {
      const room = await this.read(tx, roomId, true);
      const existing = room.seats.find(s => s.seat === config.seat);
      const scopeId = existing?.scopeId ?? randomUUID();
      const next = occupySeat(room, { ...config, scopeId }, this.definition);
      if (!existing) {
        await tx.query('INSERT INTO fw_scopes(id) VALUES($1)', [scopeId]);
        await tx.query('INSERT INTO tb_seats(room_id,seat,scope_id) VALUES($1,$2,$3)', [roomId, config.seat, scopeId]);
        await this.save(tx, next);
      }
      return next;
    });
  }

  async inspect(roomId: string): Promise<Room> { return this.read(this.store.pool, roomId); }
  async spectate(roomId: string): Promise<SpectatorView> {
    // One JSONB document is an atomic snapshot, including its events and revision.
    return spectatorView(await this.inspect(roomId), this.definition);
  }

  private async reserve(roomId: string): Promise<Room> {
    return this.store.transaction(async tx => {
      const room = await this.read(tx, roomId, true);
      if (room.status !== 'running' || room.pending) return room;
      if (room.requests >= room.limits.maxRequests) {
        room.status = 'aborted'; room.error = 'REQUEST_BUDGET_EXCEEDED'; room.revision++;
        await this.save(tx, room); return room;
      }
      const actor = eligibleActors(room)[0];
      const seat = room.seats.find(s => s.seat === actor);
      if (!seat) throw new HarnessError('INVALID_PHASE');
      if (!this.models.has(seat.modelProfile)) throw new HarnessError('UNKNOWN_MODEL');
      const scope = (await tx.query('SELECT memory_version FROM fw_scopes WHERE id=$1 FOR UPDATE', [seat.scopeId])).rows[0];
      if (!scope) throw new HarnessError('SCOPE_NOT_FOUND');
      room.pending = {
        requestId: randomUUID(), scopeId: seat.scopeId, seat: seat.seat,
        modelProfile: seat.modelProfile, memoryVersion: scope.memory_version,
        phaseInstance: room.phaseInstance, facts: actorView(room, seat.seat, this.definition),
      };
      room.requests++;
      // Reservation is operational state, not a public game event.
      await this.save(tx, room);
      return room;
    });
  }

  private binding(snapshot: Room, job: PendingDecision): Binding {
    const requirePending = (room: Room) => {
      if (room.status !== 'running' || room.pending?.requestId !== job.requestId ||
          room.pending.scopeId !== job.scopeId || room.phaseInstance !== job.phaseInstance) {
        throw new HarnessError('PHASE_CONFLICT', 409);
      }
    };
    return {
      id: `turn-based.${snapshot.id}`, version: this.definition.version, mode: 'assessment',
      inputSchema, outputSchema: snapshot.phase!.schema,
      lockResources: async (tx, scopeId) => {
        if (scopeId !== job.scopeId) throw new HarnessError('FORBIDDEN', 403);
        await this.read(tx, snapshot.id, true);
      },
      prepare: async (_input, scopeId) => {
        if (scopeId !== job.scopeId) throw new HarnessError('FORBIDDEN', 403);
        const room = await this.inspect(snapshot.id);
        requirePending(room);
        return {
          gameVersion: String(job.phaseInstance), facts: job.facts,
          instructions: this.definition.instructions,
          subjectIds: [], tags: [], requiredMemoryIds: [], visibility: [],
        };
      },
      validate: proposal => {
        try { validateDecision(snapshot, job.phaseInstance, job.seat, proposal, this.definition); return { ok: true }; }
        catch (error) { return { ok: false, code: error instanceof HarnessError ? error.code : 'RULE_FAILED' }; }
      },
      apply: async (tx, proposal, context) => {
        const room = await this.read(tx, snapshot.id, true);
        requirePending(room);
        if (context.requestId !== job.requestId || context.scopeId !== job.scopeId ||
            context.gameVersion !== String(job.phaseInstance)) throw new HarnessError('PHASE_CONFLICT', 409);
        const next = acceptDecision(room, job.phaseInstance, job.seat, proposal, this.definition);
        next.pending = null;
        await this.save(tx, next);
        return {
          result: { roomId: room.id, revision: next.revision },
          memoryChanges: [{
            op: 'append_event', id: job.requestId, visibility: 'internal',
            payload: { roomId: room.id, phaseInstance: job.phaseInstance, seat: job.seat, decision: proposal },
          }],
        };
      },
    };
  }

  /** At most one model decision per tick. Different rooms can be scheduled independently. */
  async tick(roomId: string): Promise<SpectatorView> {
    if (this.closed) throw new HarnessError('RUNTIME_CLOSED');
    const task = this.tickOnce(roomId);
    this.ticks.add(task);
    try { return await task; }
    finally { this.ticks.delete(task); }
  }

  private async tickOnce(roomId: string): Promise<SpectatorView> {
    const room = await this.reserve(roomId);
    // close() may have begun while the short reservation transaction was running.
    if (this.closed) throw new HarnessError('RUNTIME_CLOSED');
    const job = room.pending;
    if (room.status !== 'running' || !job) return spectatorView(room, this.definition);
    const model = this.models.get(job.modelProfile);
    if (!model) throw new HarnessError('UNKNOWN_MODEL');
    const harness = new Harness(this.store, model, this.options.harness).register(this.binding(room, job));
    this.active.add(harness);
    try {
      await harness.recover();
      await harness.submit({
        scopeId: job.scopeId, requestId: job.requestId, expectedMemoryVersion: job.memoryVersion,
        bindingId: `turn-based.${room.id}`, bindingVersion: this.definition.version,
        input: { roomId: room.id, phaseInstance: job.phaseInstance },
      });
      await harness.drain();
      const result = await harness.get(job.scopeId, job.requestId);
      if (result.status === 'failed' || result.status === 'rejected') {
        await this.store.transaction(async tx => {
          const current = await this.read(tx, roomId, true);
          if (current.status === 'running' && current.pending?.requestId === job.requestId) {
            current.status = 'blocked'; current.error = result.error?.code ?? 'DECISION_FAILED'; current.revision++;
            await this.save(tx, current);
          }
        });
      }
    } finally { this.active.delete(harness); }
    return this.spectate(roomId);
  }

  /** Explicit host action, never an automatic network retry. Failed attempts remain in fw_requests. */
  async resume(roomId: string): Promise<Room> {
    return this.store.transaction(async tx => {
      const room = await this.read(tx, roomId, true);
      if (room.status !== 'blocked') throw new HarnessError('ROOM_NOT_BLOCKED', 409);
      room.status = 'running'; room.pending = null; room.error = null; room.revision++;
      await this.save(tx, room);
      return room;
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    await Promise.all([...this.active].map(harness => harness.close()));
    await Promise.allSettled([...this.ticks]);
  }
}
