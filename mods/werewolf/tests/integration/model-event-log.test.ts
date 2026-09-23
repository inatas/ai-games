import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ScriptedModel } from '@game-ai/model';
import { RoomRuntime, eligibleActors } from '@game-ai/turn-based';
import { startTestDatabase } from '../../../../tests/support/database.ts';
import { ScriptDecisionAdapter } from '../../src/decision-adapter.ts';
import { werewolfDefinition } from '../../src/definition.ts';
import type { Match } from '../../src/match.ts';

test('EL-M10: a no-network model Robot leaves exact per-attempt context through a complete room', async () => {
  const db = await startTestDatabase();
  let now = 1_000;
  const model = new ScriptedModel(request => {
    const properties = (request.outputSchema as { properties: Record<string, { enum?: string[] }> }).properties;
    return JSON.stringify(properties.speech ? { speech: '我是狼人杀玩家。' }
      : { selected: properties.selected.enum![0] });
  });
  const runtime = new RoomRuntime(db.store, werewolfDefinition({ seed: 42, sheriff: 'double' }), {
    model, script: new ScriptDecisionAdapter({ speech: '我是狼人杀玩家。', strategy: 'fixed', seed: 1 }),
  }, { harness: { clock: { now: () => now } } });
  try {
    await db.store.migrate(); await runtime.migrate();
    const room = await runtime.create(randomUUID());
    const modelUserId = randomUUID();
    for (let seat = 1; seat <= 12; seat++) await runtime.seat(room.id, {
      seat, name: `${seat}号`, modelProfile: seat === 1 ? 'model' : 'script',
      controllerKind: 'robot', userId: seat === 1 ? modelUserId : randomUUID(),
    });
    for (let step = 0; step < 1500; step++) {
      const current = await runtime.inspect(room.id);
      if (current.status !== 'running') break;
      const actors = eligibleActors(current);
      if (actors.length) {
        if (current.phase?.mode === 'sealed') await runtime.tickSealed(room.id, actors[0]!);
        else await runtime.tick(room.id);
      } else {
        now = Math.min(current.phaseEarlyFinishAt ?? Infinity, current.phaseDeadlineAt ?? Infinity);
        await runtime.tick(room.id);
      }
    }
    const finalRoom = await runtime.inspect(room.id);
    assert.equal(finalRoom.status, 'finished', JSON.stringify({ phase: finalRoom.phase, now,
      deadline: finalRoom.phaseDeadlineAt, actionDeadline: finalRoom.phaseActionDeadlineAt,
      decisions: finalRoom.decisions.length, pending: finalRoom.pendingJobs }));
    assert.ok(model.calls.length > 0);
    const rows = (await db.store.pool.query(`SELECT event_type,user_id,mod_id,room_id,details
      FROM fw_event_log WHERE room_id=$1 ORDER BY sequence`, [room.id])).rows;
    const started = rows.filter(row => row.event_type === 'model.call.started.v1');
    assert.equal(started.length, model.calls.length);
    assert.ok(started.some(row => row.details.micNo === null), 'night or selection call must be logged');
    assert.ok(started.some(row => Number.isInteger(row.details.micNo)), 'speech call must be logged');
    const role = (finalRoom.state as unknown as Match).game.players.find(player => player.seat === 1)!.role;
    for (let index = 0; index < started.length; index++) {
      const row = started[index]!;
      assert.equal(row.user_id, modelUserId);
      assert.equal(row.mod_id, 'werewolf');
      assert.equal(row.room_id, room.id);
      assert.equal(row.details.seatNo, 1);
      assert.equal(row.details.role, role);
      assert.equal(row.details.simulated, true);
      assert.deepEqual(row.details.modelRequest, model.calls[index]);
      assert.equal(row.details.micNo === null, row.details.modelRequest.outputSchema.properties.selected !== undefined);
      if (row.details.micNo !== null) {
        const phase = finalRoom.phaseHistory!.find(item => item.instance === row.details.phaseInstance)!;
        const ordinal = finalRoom.phaseHistory!.filter(item => item.key === phase.key &&
          item.round === phase.round && item.instance <= phase.instance).length;
        assert.equal(row.details.micNo, ordinal);
      }
    }
  } finally { await runtime.close(); await db.stop(); }
});
