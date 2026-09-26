import { HarnessError, type RobotUser } from '@game-ai/core';
import { PostgresStore } from '@game-ai/storage';
import { RoomRuntime, type Room } from '@game-ai/turn-based';
import { werewolfDefinition } from '../src/definition.ts';
import { buildRobotAdapters } from './robot-adapters.ts';
import { loadModelProfiles, loadRobotUsers } from './robot-users.ts';
import { setupRobotRoom } from './werewolf-model-room.ts';
import { summarizeRoomTokenUsage } from './model-token-usage.ts';
import { modelRoomSnapshot } from './werewolf-model-snapshot.ts';
import type { DemoSnapshot } from '../shared/werewolf.ts';
import type { ModelProfile } from './robot-users.ts';

/** Accept only the version produced by the current game definition for this seed. */
export function modelRoomSeedFromVersion(version: string): number | null {
  const match = /^4\.(\d+)\.double\.[a-z0-9]+$/.exec(version);
  if (!match) return null;
  const seed = Number(match[1]);
  return Number.isSafeInteger(seed) && werewolfDefinition({ seed, sheriff: 'double' }).version === version ? seed : null;
}

/** Persistent trusted host for model-led Robot rooms, including twelve model seats. */
export class WerewolfModelService {
  private users = loadRobotUsers();
  private modelProfiles: ModelProfile[];
  private adapters: ReturnType<typeof buildRobotAdapters>;
  private runtimes = new Map<number, RoomRuntime>();
  private running = new Set<string>();
  private closed = false;

  constructor(private store: PostgresStore) {
    this.modelProfiles = loadModelProfiles();
    this.adapters = buildRobotAdapters(this.users, this.modelProfiles);
  }

  profiles() {
    return this.modelProfiles.filter(profile => !!this.adapters[profile.id]).map(profile => ({
      id: profile.id, label: profile.id, model: process.env[profile.environment.model] ?? '',
    }));
  }

  private runtime(seed: number): RoomRuntime {
    let runtime = this.runtimes.get(seed);
    if (!runtime) {
      runtime = new RoomRuntime(this.store, werewolfDefinition({ seed, sheriff: 'double' }), this.adapters,
        { harness: { inputBudget: 100_000, modelWindow: 128_000, outputBudget: 500, callTimeoutMs: 45000, totalTimeoutMs: 75000 } });
      this.runtimes.set(seed, runtime);
    }
    return runtime;
  }

  async migrate(): Promise<void> {
    await this.store.migrate();
    await this.runtime(0).migrate();
  }

  private async roomSeed(id: string): Promise<number> {
    const row = (await this.store.pool.query('SELECT document FROM tb_rooms WHERE id=$1', [id])).rows[0];
    if (!row || row.document.definitionId !== 'werewolf' ||
        !String(row.document.runKey).startsWith('werewolf-model:')) throw new HarnessError('ROOM_NOT_FOUND', 404);
    const seed = modelRoomSeedFromVersion(row.document.definitionVersion);
    if (seed === null) throw new HarnessError('DEFINITION_MISMATCH', 409);
    return seed;
  }

  private schedule(runtime: RoomRuntime, id: string): void {
    if (this.running.has(id) || this.closed) return;
    this.running.add(id);
    void runtime.run(id).catch(error => {
      // The room remains persisted; a later host can resume it without fabricating an action.
      console.error('Werewolf model room stopped', id, error instanceof HarnessError ? error.code : 'RUNTIME_FAILED');
    }).finally(() => this.running.delete(id));
  }

  async recover(): Promise<void> {
    const rows = (await this.store.pool.query('SELECT id, document FROM tb_rooms')).rows;
    for (const row of rows) {
      const room = row.document as Room;
      if (room.definitionId !== 'werewolf' || room.status !== 'running' ||
          !room.runKey.startsWith('werewolf-model:')) continue;
      const seed = modelRoomSeedFromVersion(room.definitionVersion);
      if (seed !== null) this.schedule(this.runtime(seed), room.id);
    }
  }

  async start(requestId: string, seed: number, userIds: string[], profileIds?: (string | null)[]): Promise<DemoSnapshot> {
    if (!/^[\w-]{8,80}$/.test(requestId) || !Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff ||
        userIds.length !== 12) throw new HarnessError('INVALID_INPUT');
    const roster = userIds.map(id => this.users.find(user => user.userId === id));
    if (roster.some(user => !user)) throw new HarnessError('UNKNOWN_ROBOT', 400);
    const selected = profileIds ?? (roster as RobotUser[]).map(user => user.control.kind === 'model' ? user.control.modelProfile : null);
    if (selected.length !== 12 || selected.some((profile, index) =>
      roster[index]?.control.kind === 'model' ? typeof profile !== 'string' || !this.adapters[profile] ||
        !this.modelProfiles.some(item => item.id === profile) : profile !== null)) throw new HarnessError('UNKNOWN_MODEL_PROFILE', 400);
    const runtime = this.runtime(seed);
    const id = await setupRobotRoom(runtime, `werewolf-model:${requestId}`, roster as RobotUser[], selected);
    this.schedule(runtime, id);
    return this.get(id);
  }

  async get(id: string, viewer: number | null = null): Promise<DemoSnapshot> {
    if (viewer !== null && (!Number.isSafeInteger(viewer) || viewer < 1 || viewer > 12)) throw new HarnessError('INVALID_VIEWER');
    const seed = await this.roomSeed(id);
    const runtime = this.runtime(seed);
    const room = await runtime.inspect(id);
    return { ...modelRoomSnapshot(room, werewolfDefinition({ seed, sheriff: 'double' }), this.users, Date.now(), viewer), seed };
  }

  /** Trusted local diagnostic read; raw model context must never enter spectator projections. */
  async events(id: string, after = 0, limit = 50) {
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new HarnessError('INVALID_INPUT');
    }
    await this.roomSeed(id);
    const rows = (await this.store.pool.query(`SELECT sequence,event_id,event_type,occurred_at,
      user_id,mod_id,room_id,request_id,result,details FROM fw_event_log
      WHERE mod_id='werewolf' AND room_id=$1 AND sequence>$2 ORDER BY sequence LIMIT $3`, [id, after, limit])).rows;
    return rows.map(row => ({ sequence: Number(row.sequence), eventId: row.event_id,
      eventType: row.event_type, occurredAt: row.occurred_at, userId: row.user_id,
      modId: row.mod_id, roomId: row.room_id, requestId: row.request_id,
      result: row.result, details: row.details }));
  }

  async calls(id: string, after = 0, limit = 50, seat?: number, result?: string) {
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
        (seat !== undefined && (!Number.isSafeInteger(seat) || seat < 1 || seat > 12)) ||
        (result !== undefined && !['started', 'succeeded', 'failed', 'unknown', 'not-sent'].includes(result))) {
      throw new HarnessError('INVALID_INPUT');
    }
    await this.roomSeed(id);
    const starts = (await this.store.pool.query(`SELECT sequence,occurred_at,request_id,user_id,details,event_type FROM fw_event_log
      WHERE mod_id='werewolf' AND room_id=$1 AND sequence>$2
        AND event_type IN ('model.call.started.v1','model.context_rejected.v1')
        AND ($3::integer IS NULL OR (details->>'seatNo')::integer=$3)
      ORDER BY sequence LIMIT 1000`, [id, after, seat ?? null])).rows;
    if (!starts.length) return [];
    const requestIds = [...new Set(starts.map(row => row.request_id))];
    const related = (await this.store.pool.query(`SELECT request_id,event_type,details FROM fw_event_log
      WHERE mod_id='werewolf' AND room_id=$1 AND request_id=ANY($2::text[])
        AND event_type IN ('model.call.finished.v1','model.call.failed.v1','model.call.orphaned.v1','model.call.judged.v1')`,
      [id, requestIds])).rows;
    const rows = starts.map(start => {
      const attempt = start.details.attempt;
      const matching = related.filter(event => event.request_id === start.request_id && event.details.attempt === attempt);
      const terminal = matching.find(event => event.event_type === 'model.call.finished.v1' ||
        event.event_type === 'model.call.failed.v1' || event.event_type === 'model.call.orphaned.v1');
      const judged = matching.find(event => event.event_type === 'model.call.judged.v1');
      const status = start.event_type === 'model.context_rejected.v1' ? 'not-sent'
        : terminal?.event_type === 'model.call.finished.v1' ? 'succeeded'
        : terminal?.event_type === 'model.call.failed.v1' ? 'failed'
        : terminal?.event_type === 'model.call.orphaned.v1' ? 'unknown' : 'started';
      const usage = terminal?.details.usage;
      return {
        sequence: Number(start.sequence), occurredAt: start.occurred_at, requestId: start.request_id,
        userId: start.user_id, seatNo: start.details.seatNo ?? null, role: start.details.role ?? null,
        phase: start.details.scene ?? null, micNo: start.details.micNo ?? null,
        profile: start.details.modelProfile ?? null, attempt, status,
        latencyMs: terminal?.details.latencyMs ?? null,
        errorCode: terminal?.details.errorCode ?? judged?.details.errorCode ?? start.details.errorCode ?? null,
        httpStatus: terminal?.details.httpStatus ?? null,
        transportCategory: terminal?.details.transportCategory ?? null,
        inputTokens: usage?.inputTokens ?? null, outputTokens: usage?.outputTokens ?? null,
        cacheHitTokens: usage?.promptCacheHitTokens ?? null, cacheMissTokens: usage?.promptCacheMissTokens ?? null,
        schemaValid: terminal?.details.schemaValid ?? null, gameCommitted: judged?.details.gameCommitted ?? null,
        promptLayoutVersion: start.details.promptLayoutVersion ?? null,
        sharedPublicBytes: start.details.sharedPublicBytes ?? null,
        sharedPublicDigest: start.details.sharedPublicDigest ?? null,
      };
    });
    return rows.filter(row => result === undefined || row.status === result).slice(0, limit);
  }

  async call(id: string, requestId: string, attempt: number) {
    if (!/^[0-9a-f-]{36}$/i.test(requestId) || !Number.isSafeInteger(attempt) || attempt < 1 || attempt > 2) {
      throw new HarnessError('INVALID_INPUT');
    }
    await this.roomSeed(id);
    const events = (await this.store.pool.query(`SELECT sequence,event_type,occurred_at,result,details FROM fw_event_log
      WHERE mod_id='werewolf' AND room_id=$1 AND request_id=$2 AND details->>'attempt'=$3
      ORDER BY sequence`, [id, requestId, String(attempt)])).rows;
    if (!events.length) throw new HarnessError('NOT_FOUND', 404);
    return { requestId, attempt, events: events.map(event => ({ sequence: Number(event.sequence),
      eventType: event.event_type, occurredAt: event.occurred_at, result: event.result, details: event.details })) };
  }

  async usage(id: string) {
    await this.roomSeed(id);
    const totals = await summarizeRoomTokenUsage(this.store, id);
    const rows = (await this.store.pool.query(`SELECT details->'usage' AS usage,
      details->>'seatNo' AS seat, details->>'scene' AS phase FROM fw_event_log
      WHERE mod_id='werewolf' AND room_id=$1 AND event_type='model.call.finished.v1'
        AND result='succeeded' AND details->>'simulated'='false'`, [id])).rows;
    type Group = { key: string; hitTokens: number; missTokens: number; rate: number | null; calls: number };
    const seats = new Map<string, Group>();
    const phases = new Map<string, Group>();
    const add = (groups: Map<string, Group>, key: string, hit: number, miss: number) => {
      const group = groups.get(key) ?? { key, hitTokens: 0, missTokens: 0, rate: null, calls: 0 };
      group.hitTokens += hit; group.missTokens += miss; group.calls++;
      if (!Number.isSafeInteger(group.hitTokens) || !Number.isSafeInteger(group.missTokens)) throw new HarnessError('MODEL_USAGE_OVERFLOW');
      group.rate = group.hitTokens + group.missTokens > 0 ? group.hitTokens / (group.hitTokens + group.missTokens) : null;
      groups.set(key, group);
    };
    for (const row of rows) {
      const usage = row.usage;
      const hit = usage?.promptCacheHitTokens;
      const miss = usage?.promptCacheMissTokens;
      if (!Number.isSafeInteger(hit) || hit < 0 || !Number.isSafeInteger(miss) || miss < 0 ||
          !Number.isSafeInteger(usage?.inputTokens) || hit + miss !== usage.inputTokens) continue;
      add(seats, row.seat ?? 'unknown', hit, miss);
      add(phases, row.phase ?? 'unknown', hit, miss);
    }
    return { ...totals,
      cacheBySeat: [...seats.values()].sort((a, b) => Number(a.key) - Number(b.key)),
      cacheByPhase: [...phases.values()].sort((a, b) => a.key.localeCompare(b.key)),
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    await Promise.all([...this.runtimes.values()].map(runtime => runtime.close()));
  }
}
