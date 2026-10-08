import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ScriptedModel } from '@game-ai/model';
import { RoomRuntime, eligibleActors } from '@game-ai/turn-based';
import { startTestDatabase } from '../../../../tests/support/database.ts';
import { ScriptDecisionAdapter } from '../../src/decision-adapter.ts';
import { werewolfDefinition } from '../../src/definition.ts';
import { decisionMemoryKey } from '../../src/decision-memory.ts';

test('WW-SC01/03/05/06: real decisions atomically persist and reread own plan, invalid update keeps it', async () => {
  const db = await startTestDatabase();
  let now = 1_000;
  let calls = 0;
  let sawOwnPlan = false;
  const plan = { tactic: '分析票型', claimedRole: null, intendedReports: [], voteTarget: null,
    nextStep: '继续依据已公开票型判断', changeReason: '', teamPlanRef: null };
  const model = new ScriptedModel(request => {
    calls++;
    const memory = request.messages.find(message => message.content.startsWith('REQUIRED_MEMORY:'))!;
    if (memory.content.includes(plan.nextStep)) sawOwnPlan = true;
    const properties = (request.outputSchema as { properties: { selected?: { enum: string[] }; speech?: object } }).properties;
    return JSON.stringify({ ...(properties.speech ? { speech: '我根据公开信息继续观察。' } : { selected: properties.selected!.enum[0] }),
      strategy_update: calls === 1 ? { set: plan } : { set: { ...plan, voteTarget: 99 } },
      personal_evidence_update: 'invalid-but-optional' });
  });
  const runtime = new RoomRuntime(db.store, werewolfDefinition({ seed: 42, sheriff: 'double' }), {
    model, script: new ScriptDecisionAdapter({ speech: '我继续观察。', strategy: 'fixed', seed: 1 }),
  }, { harness: { clock: { now: () => now }, outputBudget: 800 } });
  try {
    await db.store.migrate(); await runtime.migrate();
    const created = await runtime.create(randomUUID());
    for (let seat = 1; seat <= 12; seat++) await runtime.seat(created.id, {
      seat, name: `${seat}号`, modelProfile: seat === 3 ? 'model' : 'script', controllerKind: 'robot',
    });
    for (let step = 0; step < 500 && calls < 2; step++) {
      const room = await runtime.inspect(created.id);
      assert.equal(room.status, 'running');
      const actors = eligibleActors(room);
      if (actors.length) {
        if (room.phase?.mode === 'sealed') await runtime.tickSealed(room.id, actors[0]!);
        else await runtime.tick(room.id);
      } else { now = room.phaseDeadlineAt!; await runtime.tick(room.id); }
    }
    assert.equal(calls, 2);
    assert.equal(sawOwnPlan, true);
    const room = await runtime.inspect(created.id);
    const own = room.seats.find(seat => seat.seat === 3)!;
    const fact = await db.store.internalFact(own.scopeId, decisionMemoryKey);
    assert.deepEqual(fact?.payload, { entries: [], strategy: plan });
    for (const seat of room.seats.filter(seat => seat.seat !== 3)) {
      assert.equal(await db.store.internalFact(seat.scopeId, decisionMemoryKey), null);
    }
    assert.equal(await db.store.internalFact(own.interruptScopeId, decisionMemoryKey), null);
    assert.equal(JSON.stringify(await runtime.spectate(room.id)).includes(plan.nextStep), false);
    const errors = await db.store.pool.query("SELECT error FROM fw_requests WHERE scope_id=$1 AND status<>'committed'", [own.scopeId]);
    assert.equal(errors.rowCount, 0);
  } finally { await runtime.close(); await db.stop(); }
});
