import { HarnessError, type RobotUser } from '@game-ai/core';
import { PostgresStore } from '@game-ai/storage';
import { RoomRuntime, type Room } from '@game-ai/turn-based';
import { werewolfDefinition } from '../../../mods/werewolf/src/definition.ts';
import { buildRobotAdapters } from './robot-adapters.ts';
import { loadModelProfiles, loadRobotUsers } from './robot-users.ts';
import { setupRobotRoom } from './werewolf-model-room.ts';
import { BudgetedModelAdapter } from './model-budget.ts';
import { ModelBudgetLedger } from './model-budget-ledger.ts';
import { modelRoomSnapshot } from './werewolf-model-snapshot.ts';
import type { DemoSnapshot } from '../../shared/werewolf.ts';

/** Persistent trusted host for exactly one model Robot and eleven script Robots per room. */
export class WerewolfModelService {
  private users = loadRobotUsers();
  private adapters: ReturnType<typeof buildRobotAdapters>;
  private ledger: ModelBudgetLedger;
  private runtimes = new Map<number, RoomRuntime>();
  private running = new Set<string>();
  private closed = false;

  constructor(private store: PostgresStore) {
    const inputCnyPerMillion = Number(process.env.MODEL_INPUT_CNY_PER_MILLION);
    const outputCnyPerMillion = Number(process.env.MODEL_OUTPUT_CNY_PER_MILLION);
    if (!process.env.MODEL_INPUT_CNY_PER_MILLION || !process.env.MODEL_OUTPUT_CNY_PER_MILLION) {
      throw new HarnessError('MODEL_PRICE_MISSING');
    }
    this.ledger = new ModelBudgetLedger(store);
    this.adapters = buildRobotAdapters(this.users, loadModelProfiles(), process.env, adapter =>
      new BudgetedModelAdapter(adapter, { inputCnyPerMillion, outputCnyPerMillion }, amount => this.ledger.reserve(amount)));
  }

  private runtime(seed: number): RoomRuntime {
    let runtime = this.runtimes.get(seed);
    if (!runtime) {
      runtime = new RoomRuntime(this.store, werewolfDefinition({ seed, sheriff: 'double' }), this.adapters,
        { harness: { inputBudget: 12000, outputBudget: 500, callTimeoutMs: 45000, totalTimeoutMs: 75000 } });
      this.runtimes.set(seed, runtime);
    }
    return runtime;
  }

  async migrate(): Promise<void> {
    await this.store.migrate();
    await this.runtime(0).migrate();
    await this.ledger.migrate();
  }

  private async roomSeed(id: string): Promise<number> {
    const row = (await this.store.pool.query('SELECT document FROM tb_rooms WHERE id=$1', [id])).rows[0];
    if (!row || row.document.definitionId !== 'werewolf' ||
        !String(row.document.runKey).startsWith('werewolf-model:')) throw new HarnessError('ROOM_NOT_FOUND', 404);
    const match = /^4\.(\d+)\.double$/.exec(row.document.definitionVersion);
    if (!match) throw new HarnessError('DEFINITION_MISMATCH', 409);
    return Number(match[1]);
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
      const match = /^4\.(\d+)\.double$/.exec(room.definitionVersion);
      if (match) this.schedule(this.runtime(Number(match[1])), room.id);
    }
  }

  async start(requestId: string, seed: number, userIds: string[]): Promise<DemoSnapshot> {
    if (!/^[\w-]{8,80}$/.test(requestId) || !Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff ||
        userIds.length !== 12) throw new HarnessError('INVALID_INPUT');
    const roster = userIds.map(id => this.users.find(user => user.userId === id));
    if (roster.some(user => !user)) throw new HarnessError('UNKNOWN_ROBOT', 400);
    const runtime = this.runtime(seed);
    const id = await setupRobotRoom(runtime, `werewolf-model:${requestId}`, roster as RobotUser[]);
    this.schedule(runtime, id);
    return this.get(id);
  }

  async get(id: string, viewer: number | null = null): Promise<DemoSnapshot> {
    if (viewer !== null && (!Number.isSafeInteger(viewer) || viewer < 1 || viewer > 12)) throw new HarnessError('INVALID_VIEWER');
    const seed = await this.roomSeed(id);
    const runtime = this.runtime(seed);
    const room = await runtime.inspect(id);
    return modelRoomSnapshot(room, werewolfDefinition({ seed, sheriff: 'double' }), this.users, Date.now(), viewer);
  }

  async close(): Promise<void> {
    this.closed = true;
    await Promise.all([...this.runtimes.values()].map(runtime => runtime.close()));
  }
}
