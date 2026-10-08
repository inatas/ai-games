import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ScriptedModel } from '@game-ai/model';
import { RoomRuntime, eligibleActors } from '@game-ai/turn-based';
import { startTestDatabase } from '../../../../tests/support/database.ts';
import { ScriptDecisionAdapter } from '../../src/decision-adapter.ts';
import { werewolfDefinition } from '../../src/definition.ts';

test('WW-PM01/02/03: one model seat keeps a private judgment across real room decisions', async () => {
  const db = await startTestDatabase();
  let now = 1_000;
  let sawPrevious = false;
  let emitted = false;
  const model = new ScriptedModel(request => {
    const shared = request.messages.find(message => message.content.startsWith('SHARED_PUBLIC_FACTS:'))!;
    const history = JSON.parse(shared.content.slice('SHARED_PUBLIC_FACTS:'.length)) as { sequence?: number }[];
    const memory = request.messages.find(message => message.content.startsWith('REQUIRED_MEMORY:'))!;
    if (memory.content.includes('3号暂时关注夜间结果')) sawPrevious = true;
    const source = history.find(item => Number.isSafeInteger(item.sequence));
    const sidecar = source && !emitted ? {
      upserts: [{ topicKey: 'trust:3', judgment: '3号暂时关注夜间结果',
        basis: [{ visibility: 'public', sequence: source.sequence }] }], removeKeys: [],
    } : 'bad-shape';
    if (source && !emitted) emitted = true;
    const properties = (request.outputSchema as { properties: { selected?: { enum: string[] }; speech?: object } }).properties;
    return JSON.stringify({ ...(properties.speech ? { speech: '我继续观察公开信息。' }
      : { selected: properties.selected!.enum[0] }), personal_evidence_update: sidecar });
  });
  const runtime = new RoomRuntime(db.store, werewolfDefinition({ seed: 42, sheriff: 'double' }), {
    model, script: new ScriptDecisionAdapter({ speech: '我继续观察。', strategy: 'fixed', seed: 1 }),
  }, { harness: { clock: { now: () => now }, outputBudget: 800 } });
  try {
    await db.store.migrate(); await runtime.migrate();
    const created = await runtime.create(randomUUID());
    for (let seat = 1; seat <= 12; seat++) await runtime.seat(created.id, {
      seat, name: `${seat}号`, modelProfile: seat === 3 ? 'model' : 'script',
    });
    for (let step = 0; step < 1500 && !sawPrevious; step++) {
      const room = await runtime.inspect(created.id);
      if (room.status !== 'running') break;
      const actors = eligibleActors(room);
      if (actors.length) {
        if (room.phase?.mode === 'sealed') await runtime.tickSealed(room.id, actors[0]!);
        else await runtime.tick(room.id);
      } else {
        now = Math.min(room.phaseEarlyFinishAt ?? Infinity, room.phaseDeadlineAt ?? Infinity);
        await runtime.tick(room.id);
      }
    }
    assert.equal(emitted, true, 'model seat should see a public source');
    assert.equal(sawPrevious, true, 'later model request should read its own committed judgment');
    const room = await runtime.inspect(created.id);
    const ownScope = room.seats.find(seat => seat.seat === 3)!.scopeId;
    const fact = await db.store.internalFact(ownScope, 'werewolf.personal-evidence.v1');
    assert.equal((fact?.payload as { entries: { judgment: string }[] }).entries[0]?.judgment, '3号暂时关注夜间结果');
    for (const seat of room.seats.filter(seat => seat.seat !== 3)) {
      assert.equal(await db.store.internalFact(seat.scopeId, 'werewolf.personal-evidence.v1'), null);
    }
    assert.equal(JSON.stringify(await runtime.spectate(room.id)).includes('3号暂时关注夜间结果'), false);
  } finally { await runtime.close(); await db.stop(); }
});
