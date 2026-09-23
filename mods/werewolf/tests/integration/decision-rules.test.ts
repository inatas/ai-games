import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomRuntime, eligibleActors, evaluateDecisionRules } from '@game-ai/turn-based';
import { startTestDatabase } from '../../../../tests/support/database.ts';
import { ScriptDecisionAdapter } from '../../src/decision-adapter.ts';
import { prepareWerewolfDecision } from '../../src/decision-input.ts';
import { werewolfDefinition } from '../../src/definition.ts';
import { werewolfDecisionRules } from '../../src/decision-rules/index.ts';
import type { Match } from '../../src/match.ts';

let db: Awaited<ReturnType<typeof startTestDatabase>>;
let runtime: RoomRuntime;
before(async () => { db = await startTestDatabase(); await db.store.migrate(); });
after(async () => { await runtime?.close(); await db?.stop(); });

test('WW-R01: real room persists the sampled rule and forces a legal nomination without a model call', async () => {
  let now = 1_000;
  const base = werewolfDefinition({ seed: 42, sheriff: 'double' });
  const forcedRules = { ...werewolfDecisionRules, rules: [{ ...werewolfDecisionRules.rules[0]!, probability: 1 }] };
  const definition = { ...base, decisionRules: forcedRules };
  const adapter = new ScriptDecisionAdapter({ speech: '发言', seed: 1, strategy: 'fixed' });
  runtime = new RoomRuntime(db.store, definition, { script: adapter }, { harness: { clock: { now: () => now } } });
  await runtime.migrate();
  const created = await runtime.create('rules-runtime-test');
  for (let seat = 1; seat <= 12; seat++) {
    await runtime.seat(created.id, { seat, name: `Robot ${seat}`, modelProfile: 'script', controllerKind: 'robot' });
  }
  for (let step = 0; step < 25; step++) {
    const room = await runtime.inspect(created.id);
    if (room.phase?.key === 'nominations') break;
    if (eligibleActors(room).length) await runtime.tick(created.id);
    else { now = room.phaseDeadlineAt!; await runtime.tick(created.id); }
  }
  const dawn = await runtime.inspect(created.id);
  assert.equal(dawn.phase?.key, 'nominations');
  const seer = (dawn.state as unknown as Match).game.players.find(player => player.role === 'seer')!.seat;
  const input = prepareWerewolfDecision(dawn, seer, definition);
  const expected = evaluateDecisionRules(forcedRules, input);
  assert.ok(expected.requiredOptionId);
  await runtime.tickSealed(created.id, seer);
  const afterNomination = await runtime.inspect(created.id);
  const trace = afterNomination.ruleDecisions!.find(item => item.seat === seer && item.phaseInstance === dawn.phaseInstance)!;
  assert.deepEqual(trace.evaluation, expected);
  const action = afterNomination.decisions.find(item => item.seat === seer)?.value as { run: boolean };
  assert.equal(action.run, true);
  assert.equal(trace.forced, true);
  assert.equal(afterNomination.requests, dawn.requests);
  assert.equal(JSON.stringify(await runtime.spectate(created.id)).includes('seer-first-day-run'), false);
  const recovered = new RoomRuntime(db.store, definition, { script: adapter }, { harness: { clock: { now: () => now } } });
  try { assert.deepEqual((await recovered.inspect(created.id)).ruleDecisions, afterNomination.ruleDecisions); }
  finally { await recovered.close(); }
});
