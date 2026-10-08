import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { HarnessError, type ModelRequest } from '@game-ai/core';
import { ScriptedModel } from '@game-ai/model';
import { RoomRuntime, eligibleActors } from '@game-ai/turn-based';
import { startTestDatabase } from '../../../../tests/support/database.ts';
import { werewolfDefinition } from '../../src/definition.ts';
import { prepareWerewolfDecision } from '../../src/decision-input.ts';
import type { Match } from '../../src/match.ts';

function facts(request: ModelRequest) {
  return JSON.parse(request.messages.find(m => m.content.startsWith('CURRENT_FACTS:'))!.content.slice('CURRENT_FACTS:'.length));
}
function proposal(target: number | null, peers: number[] = []) {
  return { speech: '这是建议，白天根据局势调整。', team_proposal: { knifeTarget: target,
    assignments: peers.map(seat => ({ seat, tactic: '倒钩', claimedRole: 'villager', instruction: '按公开发言判断站边' })),
    conditions: '', selfKnifeConsent: false } };
}
async function ready(runtime: RoomRuntime) {
  await runtime.migrate(); const created = await runtime.create(randomUUID());
  for (let seat = 1; seat <= 12; seat++) await runtime.seat(created.id, { seat, name: `${seat}号`,
    modelProfile: 'model', controllerKind: 'robot' });
  return runtime.inspect(created.id);
}

test('WW-TC02/05/06/08: one proposal, durable shared cutoff, sealed responses, exact logs and private late context', async () => {
  const db = await startTestDatabase(); let now = 1_000;
  let good = 0; let peers: number[] = [];
  const model = new ScriptedModel(request => {
    const context = facts(request);
    if (context.current_action.scene === 'wolf-team-proposal') return JSON.stringify(proposal(good, peers));
    const options = context.current_action.options as { id: string; value: { kind: string; target: number } }[];
    const selected = options.find(o => o.value.target === good) ?? options[0];
    const plan = context.private_information.team_plan;
    return JSON.stringify({ selected: selected.id, ...(context.self.role === 'wolf' ? {
      team_response: { planId: plan.planId, version: plan.version, assignmentStance: 'adjust', note: '我按局势调整' },
    } : {}) });
  });
  const definition = werewolfDefinition({ seed: 42, sheriff: 'double' });
  let runtime = new RoomRuntime(db.store, definition, { model }, { harness: { clock: { now: () => now } } });
  try {
    await db.store.migrate(); const created = await ready(runtime);
    const match = created.state as unknown as Match;
    good = match.game.players.find(p => p.role !== 'wolf')!.seat;
    peers = match.wolfTeam!.participants;
    const deadline = created.phaseDeadlineAt!;
    await Promise.all([runtime.tick(created.id), runtime.tick(created.id)]);
    assert.equal(model.calls.length, 1, 'same lane must not dispatch duplicate logical requests');
    assert.equal((await runtime.inspect(created.id)).phase?.key, 'wolf-team-wait');
    await runtime.tick(created.id);
    assert.equal(model.calls.length, 1, 'wait must never call a model');
    await runtime.close();
    runtime = new RoomRuntime(db.store, definition, { model }, { harness: { clock: { now: () => now } } });
    const restored = await runtime.inspect(created.id);
    assert.equal(restored.phaseDeadlineAt, deadline);
    assert.equal((restored.state as unknown as Match).wolfTeam!.plan!.payload.knifeTarget, good);
    now = deadline; await runtime.tick(created.id);
    let room = await runtime.inspect(created.id);
    assert.equal(room.phase?.key, 'wolves');
    assert.equal(room.phaseDeadlineAt, deadline + 60_000);
    const frozen = peers.map(seat => prepareWerewolfDecision(room, seat, definition).context.private_information);
    for (const seat of eligibleActors(room)) await runtime.tickSealed(created.id, seat);
    room = await runtime.inspect(created.id);
    assert.equal(room.events.some(e => e.type === 'wolf-team-response'), false);
    assert.deepEqual(peers.map(seat => prepareWerewolfDecision({ ...room, decisions: [] }, seat, definition).context.private_information), frozen);
    now = room.phaseDeadlineAt!; await runtime.tick(created.id);
    room = await runtime.inspect(created.id);
    const responses = room.events.filter(e => e.type === 'wolf-team-response');
    assert.equal(responses.length, 4);
    assert.ok(responses.every(e => (e.data as { assignment: { assignmentStance: string } }).assignment.assignmentStance === 'adjust'));
    assert.doesNotMatch(JSON.stringify(await runtime.spectate(created.id)), /这是建议|我按局势调整|team_plan/);
    const rows = (await db.store.pool.query('SELECT event_type,details FROM fw_event_log WHERE room_id=$1 ORDER BY sequence', [created.id])).rows;
    const started = rows.filter(r => r.event_type === 'model.call.started.v1');
    assert.equal(started.length, model.calls.length);
    assert.deepEqual(started[0].details.modelRequest, model.calls[0]);
    assert.ok(rows.some(r => r.event_type === 'model.call.finished.v1' && JSON.stringify(r.details).includes('team_proposal')));
    const firstMessages = model.calls[0].messages;
    const firstPrivate = firstMessages.findIndex(m => m.content.startsWith('PRIVATE_KNOWLEDGE:'));
    const lastMessages = model.calls.at(-1)!.messages;
    assert.deepEqual(firstMessages.slice(0, firstPrivate), lastMessages.slice(0, firstPrivate), 'public KV prefix survives private team updates');
  } finally { await runtime.close(); await db.stop(); }
});

test('WW-TC03/04/11: consent refusal permits one ordinary backup, never another consent or forced knife', async () => {
  const db = await startTestDatabase(); let now = 1_000; let target = 0; let good = 0;
  const model = new ScriptedModel(request => {
    const context = facts(request);
    if (context.current_action.scene === 'wolf-team-self-knife-consent') {
      const no = context.current_action.options.find((o: { value: { accepted: boolean } }) => !o.value.accepted);
      return JSON.stringify({ selected: no.id });
    }
    assert.equal(context.current_action.scene, 'wolf-team-proposal');
    const backup = context.current_action.team_organization.slot === 'backup';
    if (backup) assert.equal(context.current_action.team_organization.normalOnly, true);
    return JSON.stringify(proposal(backup ? good : target));
  });
  const definition = werewolfDefinition({ seed: 42, sheriff: 'double' });
  const runtime = new RoomRuntime(db.store, definition, { model }, { harness: { clock: { now: () => now } } });
  try {
    await db.store.migrate(); const created = await ready(runtime);
    const match = created.state as unknown as Match;
    target = match.wolfTeam!.participants[1]!; good = match.game.players.find(p => p.role !== 'wolf')!.seat;
    await runtime.tick(created.id); await runtime.tick(created.id); await runtime.tick(created.id); await runtime.tick(created.id);
    let room = await runtime.inspect(created.id);
    assert.equal(model.calls.length, 3);
    assert.equal(room.phase?.key, 'wolf-team-wait');
    assert.deepEqual((room.state as unknown as Match).wolfTeam!.used, { primary: true, backup: true, consent: true });
    assert.equal((room.state as unknown as Match).wolfTeam!.plan!.version, 2);
    now = room.phaseDeadlineAt!; await runtime.tick(created.id); room = await runtime.inspect(created.id);
    const leader = match.wolfTeam!.participants[0];
    const input = prepareWerewolfDecision(room, leader, definition);
    assert.equal(input.options.some(o => (o.value as { target: number }).target === target), false);
    assert.ok(input.options.some(o => (o.value as { target: number | null }).target === null), 'abstention remains voluntary');
  } finally { await runtime.close(); await db.stop(); }
});

test('WW-TC03/09: terminal failure advances once; short remainder skips backup without provider cost', async () => {
  const db = await startTestDatabase(); let now = 1_000;
  const model = new ScriptedModel(() => { throw new HarnessError('MODEL_UNAVAILABLE'); });
  const runtime = new RoomRuntime(db.store, werewolfDefinition({ seed: 42, sheriff: 'double' }), { model },
    { harness: { clock: { now: () => now } } });
  try {
    await db.store.migrate(); const created = await ready(runtime);
    await runtime.tick(created.id);
    let room = await runtime.inspect(created.id);
    assert.equal((room.state as unknown as Match).wolfTeam!.step, 'backup');
    assert.equal((room.events.find(e => e.type === 'wolf-team-call')!.data as { reason: string }).reason, 'MODEL_UNAVAILABLE');
    now = room.phaseDeadlineAt! - 5_000; await runtime.tick(created.id); await runtime.tick(created.id);
    room = await runtime.inspect(created.id);
    assert.equal(model.calls.length, 1);
    assert.equal(room.phase?.key, 'wolf-team-wait');
    assert.equal((room.state as unknown as Match).wolfTeam!.plan, null);
    now = created.phaseDeadlineAt!; await runtime.tick(created.id);
    assert.equal((await runtime.inspect(created.id)).phase?.key, 'wolves');
    assert.ok((await db.store.pool.query("SELECT details FROM fw_event_log WHERE room_id=$1 AND event_type='model.call.failed.v1'", [created.id])).rowCount);
  } finally { await runtime.close(); await db.stop(); }
});

test('WW-TC09: late successful proposal retains usage log but cannot change frozen state or private memory', async () => {
  const db = await startTestDatabase(); let now = 1_000;
  let release!: (raw: string) => void; let started!: () => void;
  const began = new Promise<void>(resolve => { started = resolve; });
  const pending = new Promise<string>(resolve => { release = resolve; });
  const model = new ScriptedModel(async () => { started(); return pending; });
  const runtime = new RoomRuntime(db.store, werewolfDefinition({ seed: 42, sheriff: 'double' }), { model },
    { harness: { clock: { now: () => now } } });
  try {
    await db.store.migrate(); const created = await ready(runtime);
    const task = runtime.tick(created.id); await began;
    now = created.phaseDeadlineAt!; await runtime.tick(created.id);
    release(JSON.stringify(proposal(null))); await task;
    const room = await runtime.inspect(created.id);
    assert.equal(room.phase?.key, 'wolves');
    assert.equal((room.state as unknown as Match).wolfTeam!.plan, null);
    assert.equal(room.events.some(e => e.type === 'wolf-team-speech'), false);
    assert.equal(model.calls.length, 1);
    const logs = (await db.store.pool.query('SELECT event_type,details FROM fw_event_log WHERE room_id=$1', [created.id])).rows;
    assert.ok(logs.some(r => r.event_type === 'model.call.finished.v1' && r.details.usage.outputTokens === 20));
    const requests = (await db.store.pool.query('SELECT status FROM fw_requests')).rows;
    assert.ok(requests.every(r => r.status !== 'committed'));
  } finally { release?.('{}'); await runtime.close(); await db.stop(); }
});
