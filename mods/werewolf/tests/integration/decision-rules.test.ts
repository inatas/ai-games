import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomRuntime, eligibleActors, evaluateDecisionRules, type DecisionAdapter, type DecisionInput } from '@game-ai/turn-based';
import { startTestDatabase } from '../../../../tests/support/database.ts';
import { ScriptDecisionAdapter } from '../../src/decision-adapter.ts';
import { prepareWerewolfDecision } from '../../src/decision-input.ts';
import { werewolfDefinition } from '../../src/definition.ts';
import { werewolfDecisionRules } from '../../src/decision-rules/index.ts';
import type { Match } from '../../src/match.ts';

let db: Awaited<ReturnType<typeof startTestDatabase>>;
const runtimes: RoomRuntime[] = [];
before(async () => { db = await startTestDatabase(); await db.store.migrate(); });
after(async () => { await Promise.all(runtimes.map(runtime => runtime.close())); await db?.stop(); });

test('WW-R01: real room persists the sampled rule and forces a legal nomination without a model call', async () => {
  let now = 1_000;
  const definition = werewolfDefinition({ seed: 42, sheriff: 'double' });
  const forcedRules = { ...werewolfDecisionRules, rules: [{ ...werewolfDecisionRules.rules[0]!, probability: 1 }] };
  definition.decisionRules = forcedRules;
  const adapter = new ScriptDecisionAdapter({ speech: '发言', seed: 1, strategy: 'fixed' });
  const runtime = new RoomRuntime(db.store, definition, { script: adapter }, { harness: { clock: { now: () => now } } });
  runtimes.push(runtime);
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

test('DR-v2: matched instructions reach only the authorized robot and a changed digest cannot resume its room', async () => {
  let now = 1_000;
  const definition = werewolfDefinition({ seed: 42, sheriff: 'double' });
  const privateText = 'Private seer nomination strategy';
  definition.decisionRules = {
    id: 'private-rule-test', version: 2, digest: 'source-a', rules: [{
      id: 'seer-guidance', priority: 100, mode: 'guidance', instruction: privateText,
      matches: input => input.scene === 'nominations' && input.context.self.role === 'seer',
    }],
  };
  const captured: DecisionInput[] = [];
  const adapter: DecisionAdapter = { async decide(input) {
    captured.push(input);
    return input.intent === 'SPEAK'
      ? { kind: 'proposal', value: { speech: '发言' } }
      : { kind: 'proposal', value: { selected: input.options[0]!.id } };
  } };
  const runtime = new RoomRuntime(db.store, definition, { script: adapter }, { harness: { clock: { now: () => now } } });
  runtimes.push(runtime);
  await runtime.migrate();
  const created = await runtime.create('guidance-runtime-test');
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
  const other = dawn.phase!.actors.find(seat => seat !== seer)!;
  await runtime.tickSealed(created.id, seer);
  await runtime.tickSealed(created.id, other);
  const seerInput = captured.find(input => input.scene === 'nominations' && input.actor.seat === seer)!;
  const otherInput = captured.find(input => input.scene === 'nominations' && input.actor.seat === other)!;
  assert.match(JSON.stringify(seerInput.context.rules), /Private seer nomination strategy/);
  assert.doesNotMatch(JSON.stringify(otherInput.context.rules), /Private seer nomination strategy/);
  assert.doesNotMatch(JSON.stringify(await runtime.spectate(created.id)), /Private seer nomination strategy/);
  definition.decisionRules = { ...definition.decisionRules, digest: 'source-b' };
  await assert.rejects(() => runtime.inspect(created.id), /RULE_SET_MISMATCH/);
});

test('WW-S05: a real speech reservation keeps shared guidance out of private facts and public replay', async () => {
  let now = 1_000;
  const definition = werewolfDefinition({ seed: 42, sheriff: 'none' });
  const captured: DecisionInput[] = [];
  const adapter: DecisionAdapter = { async decide(input) {
    captured.push(input);
    return input.intent === 'SPEAK'
      ? { kind: 'proposal', value: { speech: '发言' } }
      : { kind: 'proposal', value: { selected: input.options[0]!.id } };
  } };
  const runtime = new RoomRuntime(db.store, definition, { script: adapter }, { harness: { clock: { now: () => now } } });
  runtimes.push(runtime);
  await runtime.migrate();
  const created = await runtime.create('speech-guidance-runtime-test');
  for (let seat = 1; seat <= 12; seat++) {
    await runtime.seat(created.id, { seat, name: `Robot ${seat}`, modelProfile: 'script', controllerKind: 'robot' });
  }
  for (let step = 0; step < 35; step++) {
    const room = await runtime.inspect(created.id);
    if (captured.filter(input => input.intent === 'SPEAK').length >= 2) break;
    if (eligibleActors(room).length) await runtime.tick(created.id);
    else { now = room.phaseDeadlineAt!; await runtime.tick(created.id); }
  }
  const speeches = captured.filter(input => input.intent === 'SPEAK');
  assert.ok(speeches.length >= 2);
  assert.deepEqual(speeches[0]!.stableGuidance, speeches[1]!.stableGuidance);
  assert.match(speeches[0]!.stableGuidance![0]!, /只用座位号/);
  assert.equal(JSON.stringify(speeches[0]!.context.rules).includes('只用座位号'), false);
  assert.equal(JSON.stringify(await runtime.spectate(created.id)).includes('只用座位号'), false);
});
