import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { canonical, type ModelRequest, type Json } from '@game-ai/core';
import { ScriptedModel } from '@game-ai/model';
import { RoomRuntime, eligibleActors } from '@game-ai/turn-based';
import { startTestDatabase } from '../../../../tests/support/database.ts';
import { barrier } from '../../../../tests/support/counter.ts';
import { werewolfDefinition } from '../../src/definition.ts';
import { prepareWerewolfDecision } from '../../src/decision-input.ts';
import type { Match } from '../../src/match.ts';

let db: Awaited<ReturnType<typeof startTestDatabase>>;
const runtimes: RoomRuntime[] = [];
before(async () => { db = await startTestDatabase(); await db.store.migrate(); });
after(async () => { await Promise.all(runtimes.map(r => r.close())); await db?.stop(); });
const definition = werewolfDefinition({ seed: 42, sheriff: 'double' });

/** Omniscient deterministic acceptance driver, never presented as AI performance. */
function decision(request: ModelRequest, state: Match, seat: number, nominate: boolean, hunterChain: boolean): Json {
  if (state.stage === 'wolves') {
    if (state.game.players.find(p => p.seat === seat)!.role === 'seer') return { kind: 'inspect', target: state.game.players.find(p => p.alive && p.seat !== state.game.inspections.at(-1)?.target)!.seat };
    return { kind: 'knife', target: hunterChain && state.game.night === 1 ? state.game.players.find(p => p.role === 'hunter')!.seat : null };
  }
  const root = request.outputSchema as { oneOf?: object[]; properties?: Record<string, { const?: string; enum?: Json[] }> };
  if (root.oneOf) return { kind: 'pass' };
  const properties = root.properties!;
  if (properties.kind.enum) return { kind: 'explode' };
  const kind = properties.kind.const!;
  switch (kind) {
    case 'knife': return { kind, target: hunterChain && state.game.night === 1 ? state.game.players.find(p => p.role === 'hunter')!.seat : null };
    case 'shot': return { kind, target: state.game.players.find(p => p.alive && p.role === 'wolf')!.seat };
    case 'inspect': return { kind, target: properties.target.enum![0] };
    case 'nominate': return { kind, run: nominate && seat <= 2 };
    case 'withdraw': return { kind, withdraw: false };
    case 'direction': return { kind, direction: 'clockwise' };
    case 'speak': case 'last-words': return { kind, text: `seat-${seat}-public` };
    case 'vote': return { kind, target: state.stage === 'election' ? state.election!.candidates[0]
      : state.game.players.find(p => p.alive && p.role === 'wolf')!.seat };
    default: return { kind, target: null };
  }
}
async function game(nominate = false, hold?: (request: ModelRequest) => Promise<void>, hunterChain = false) {
  let roomId = '';
  let now = 1_000;
  let reader: RoomRuntime;
  const profiles = Object.fromEntries(Array.from({ length: 12 }, (_, i) => {
    const seat = i + 1;
    return [`seat-${seat}`, new ScriptedModel(async request => {
      await hold?.(request);
      const room = await reader.inspect(roomId);
      const state = room.state as unknown as Match;
      const schema = request.outputSchema as { properties?: Record<string, object> };
      if (!schema.properties?.selected && !schema.properties?.speech) {
        return JSON.stringify(decision(request, state, seat, nominate, hunterChain));
      }
      const task = prepareWerewolfDecision(room, seat, definition);
      const wanted = decision({ ...request, outputSchema: room.phase!.schema }, state, seat, nominate, hunterChain);
      if (task.intent === 'SPEAK') return JSON.stringify({ speech: (wanted as { text: string }).text });
      const option = task.options.find(item => canonical(item.value) === canonical(wanted));
      if (!option) throw new Error(`NO_TEST_OPTION:${room.phase?.key}:${seat}`);
      return JSON.stringify({ selected: option.id });
    })];
  }));
  function restart() { reader = new RoomRuntime(db.store, definition, profiles,
    { harness: { inputBudget: 64_000, modelWindow: 128_000, clock: { now: () => now } } }); runtimes.push(reader); return reader; }
  const r = restart(); await r.migrate(); const room = await r.create(randomUUID()); roomId = room.id;
  for (let seat = 1; seat <= 12; seat++) await r.seat(roomId, { seat, name: `AI ${seat}`, modelProfile: `seat-${seat}` });
  async function until(predicate: (match: Match, room: Awaited<ReturnType<RoomRuntime['inspect']>>) => boolean, runtime = reader) {
    for (let i = 0; i < 500; i++) {
      const snapshot = await runtime.inspect(roomId);
      if (predicate(snapshot.state as unknown as Match, snapshot)) return snapshot;
      assert.equal(snapshot.status, 'running', snapshot.error + ':' + snapshot.phase?.key);
      await runtime.tick(roomId);
      const after = await runtime.inspect(roomId);
      if (after.phaseInstance === snapshot.phaseInstance && eligibleActors(after).length === 0 && after.phaseDeadlineAt !== undefined) {
        now = Math.min(after.phaseEarlyFinishAt ?? Infinity, after.phaseDeadlineAt);
      }
    }
    const stalled = await runtime.inspect(roomId);
    throw new Error(`SCRIPT_LIMIT:${now}:${stalled.phase?.key}:${stalled.phaseInstance}:${stalled.decisions.length}:${eligibleActors(stalled).join(',')}:${Object.values(stalled.pendingJobs).map(job => job?.failedReason ?? job?.lane).join(',')}`);
  }
  return { r, roomId, profiles, restart, until };
}

test('WW-73/77/79/80: real database interrupts waiting speech, restarts and finishes without late facts', async () => {
  const gate = barrier(); let holdSpeech = false;
  const gameRun = await game(false, async request => {
    const schema = request.outputSchema as { properties?: { speech?: object } };
    if (holdSpeech && schema.properties?.speech) await gate.wait();
  });
  const { r, roomId, profiles, until, restart } = gameRun;
  const dawn = await until((state, room) => state.stage === 'speech' && eligibleActors(room).length > 0);
  const state = dawn.state as unknown as Match;
  const speaker = dawn.phase!.actors[0];
  const wolf = state.game.players.find(p => p.role === 'wolf' && p.seat !== speaker)!.seat;
  holdSpeech = true; const normal = r.tick(roomId); await gate.ready;
  try {
    await r.tickInterrupt(roomId, wolf);
    const after = await r.inspect(roomId);
    assert.equal((after.state as unknown as Match).game.night, 2);
    assert.equal(after.events.filter(e => e.type === 'wolf-explosion').length, 1);
  } finally { holdSpeech = false; gate.release(); await normal; }
  assert.equal((await db.store.memory(dawn.seats[speaker - 1].scopeId, ['internal'])).filter(m => JSON.stringify(m.payload).includes('speak')).length, 0);
  const interruptInput = profiles[`seat-${wolf}`].calls.at(-1)!;
  assert.doesNotMatch(JSON.stringify(interruptInput.messages), /antidote|inspections/);
  assert.doesNotMatch(JSON.stringify(await r.spectate(roomId)), /interruptScopeId|antidote|inspections/);
  const restored = restart();
  await until(match => match.stage === 'finished', restored);
  const final = await restored.spectate(roomId);
  assert.equal(final.status, 'finished'); assert.ok(final.replay);
  assert.equal(final.events.filter(e => e.type === 'wolf-explosion').length, 1);
  assert.equal((final.result as { winner: string }).winner, 'good');
});

test('WW-78/79: actual runtime preserves nominations across first explosion and restart; second loses badge', async () => {
  const { r, roomId, until, restart } = await game(true);
  const election = await until(state => state.stage === 'election');
  const state = election.state as unknown as Match;
  const wolves = state.game.players.filter(p => p.role === 'wolf').map(p => p.seat);
  const nominations = state.election!.registered;
  const firstWolf = wolves.find(seat => !nominations.includes(seat))!;
  await r.tickInterrupt(roomId, firstWolf);
  const restored = restart();
  const nextDay = await until(match => match.stage === 'election', restored);
  assert.deepEqual((nextDay.state as unknown as Match).election!.registered, nominations);
  await restored.tickInterrupt(roomId, wolves.find(seat => seat !== firstWolf)!);
  const next = await restored.inspect(roomId);
  const match = next.state as unknown as Match;
  assert.equal(match.game.sheriff, null);
  assert.equal(match.game.night, 3);
  assert.equal(match.election!.stage, 'finished');
  assert.equal(next.events.filter(e => e.type === 'wolf-explosion').length, 2);
  await until(current => current.stage === 'finished', restart());
  assert.equal((await r.inspect(roomId)).events.filter(e => e.type === 'wolf-explosion').length, 2);
});

test('WW-75/79: persisted hunter death chain resumes after gun without repeating shot or early reveal', async () => {
  const { r, roomId, until, restart } = await game(false, undefined, true);
  const shot = await until(state => state.stage === 'settlement' && state.settlement!.queue[0].kind === 'shot');
  assert.equal((await r.spectate(roomId)).replay, undefined);
  await r.tick(roomId);
  assert.equal((await r.inspect(roomId)).decisions.length, 1);
  const after = await until(state => state.stage === 'settlement' && state.settlement!.queue[0].kind === 'last-words');
  const match = after.state as unknown as Match;
  assert.equal(match.stage, 'settlement');
  assert.equal(match.settlement!.queue[0].kind, 'last-words');
  assert.equal(after.events.filter(event => event.type === 'hunter-shot').length, 1);
  const restored = restart();
  await until(state => state.stage === 'finished', restored);
  const final = await restored.spectate(roomId);
  assert.equal(final.events.filter(event => event.type === 'hunter-shot').length, 1);
  assert.ok(final.replay);
  const hunterScope = shot.seats.find(seat => seat.seat === shot.phase!.actors[0])!.scopeId;
  const effective = await db.store.memory(hunterScope, ['internal']);
  assert.equal(effective.filter(memory => (memory.payload as { decision?: { kind?: string } }).decision?.kind === 'shot').length, 1);
});
