import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/rules.ts';
import { beginWolfTeam, advanceWolfTeam, teamActor, parseTeamProposal, parseTeamResponse, permittedWolfTargets } from '../src/wolf-team.ts';

function setup() {
  const game = createGame(42);
  const team = beginWolfTeam(game, 42);
  const leader = teamActor(team)!;
  const peer = team.participants.find(seat => seat !== leader)!;
  const good = game.players.find(p => p.role !== 'wolf')!.seat;
  return { game, team, leader, peer, good };
}
const proposal = (target: number | null, selfKnifeConsent = false) =>
  ({ knifeTarget: target, assignments: [], conditions: '', selfKnifeConsent });

test('WW-TC01/02/10: one ordinary proposal finishes work, retains seeded leadership and no invented consent', () => {
  const { game, team, leader, good } = setup();
  const raw = parseTeamProposal(proposal(good), game, team, leader)!;
  const next = advanceWolfTeam(team, game, leader, { text: '今晚刀目标', proposal: raw }, 'model');
  assert.equal(next.team.step, 'wait');
  assert.equal(next.team.used.primary, true);
  assert.equal(next.team.used.backup, false);
  assert.equal(next.team.used.consent, false);
  assert.equal(next.team.plan?.status, 'proposed');
  assert.equal(next.team.plan?.consent, null);
  assert.ok(next.events.every(e => Array.isArray(e.audience) && !e.audience.includes(good)));
  const later = beginWolfTeam({ ...game, night: 2 }, 42, team.order);
  assert.equal(teamActor(later), leader);
});

test('WW-TC04/11: teammate self-knife requires explicit target acceptance, not a default', () => {
  const { game, team, leader, peer } = setup();
  let next = advanceWolfTeam(team, game, leader, { text: '建议刀队友', proposal: proposal(peer) }, 'model');
  assert.equal(next.team.step, 'consent');
  assert.equal(teamActor(next.team), peer);
  assert.equal(permittedWolfTargets(game, next.team, leader).includes(peer), false);
  next = advanceWolfTeam(next.team, game, peer, { accepted: true }, 'model');
  assert.equal(next.team.step, 'wait');
  assert.equal(permittedWolfTargets(game, next.team, leader).includes(peer), true);
  const rejected = advanceWolfTeam(advanceWolfTeam(team, game, leader,
    { text: '建议刀队友', proposal: proposal(peer) }, 'model').team, game, peer, { accepted: true }, 'default');
  assert.equal(rejected.team.step, 'backup');
  assert.equal(rejected.team.normalOnly, true);
  const backup = teamActor(rejected.team)!;
  assert.equal(parseTeamProposal(proposal(leader), game, rejected.team, backup), null);
});

test('WW-TC03/11: primary failure permits one backup and at most one target request', () => {
  const { game, team, leader } = setup();
  let next = advanceWolfTeam(team, game, leader, { text: '', proposal: null, reason: 'MODEL_UNAVAILABLE' }, 'default');
  assert.equal(next.team.step, 'backup');
  const backup = teamActor(next.team)!;
  next = advanceWolfTeam(next.team, game, backup, { text: '提议刀原组织者', proposal: proposal(leader) }, 'model');
  assert.equal(next.team.step, 'consent');
  next = advanceWolfTeam(next.team, game, leader, { accepted: false }, 'model');
  assert.equal(next.team.step, 'wait');
  assert.deepEqual(next.team.used, { primary: true, backup: true, consent: true });
  assert.throws(() => advanceWolfTeam(next.team, game, backup, { text: '重复提议', proposal: proposal(null) }, 'model'));
});

test('WW-TC04: explicit own self-knife saves target call; team claims cannot grant another player consent', () => {
  const { game, team, leader, peer } = setup();
  const next = advanceWolfTeam(team, game, leader, { text: '我承担自刀风险', proposal: proposal(leader, true) }, 'model');
  assert.equal(next.team.step, 'wait');
  assert.equal(next.team.used.consent, false);
  assert.equal(next.team.plan?.consent?.accepted, true);
  assert.equal(parseTeamProposal(proposal(peer, true), game, team, leader), null);
});

test('WW-TC12: assignment response is seat-local and version-bound; knife alone is not acceptance', () => {
  const { game, team, leader, peer, good } = setup();
  const raw = { ...proposal(good), assignments: [{ seat: peer, tactic: '倒钩', claimedRole: 'villager', instruction: '根据新发言调整站边' }] };
  const next = advanceWolfTeam(team, game, leader, { text: '我提出分工', proposal: raw }, 'model');
  const response = { planId: next.team.plan!.planId, version: next.team.plan!.version, assignmentStance: 'adjust', note: '改成弱站边' };
  assert.deepEqual(parseTeamResponse(response, next.team.plan, peer), response);
  assert.equal(parseTeamResponse(response, next.team.plan, leader), null);
  assert.equal(parseTeamResponse({ ...response, version: 99 }, next.team.plan, peer), null);
  assert.equal(parseTeamResponse({ ...response, assignmentStance: 'accept', proxySeat: leader }, next.team.plan, peer), null);
  assert.equal(parseTeamResponse(undefined, next.team.plan, peer), null);
});

test('WW-TC01/03: persisted state is immutable, failed backup has no third proposal, dead organizer is replaced', () => {
  const { game, team, leader } = setup();
  const before = structuredClone(team);
  let next = advanceWolfTeam(team, game, leader, { text: '', proposal: null }, 'default');
  assert.deepEqual(team, before);
  next = advanceWolfTeam(JSON.parse(JSON.stringify(next.team)), game, teamActor(next.team)!, { text: '', proposal: null }, 'default');
  assert.equal(next.team.step, 'wait');
  assert.deepEqual(next.team.used, { primary: true, backup: true, consent: false });
  const laterGame = structuredClone(game);
  laterGame.night++;
  laterGame.players.find(p => p.seat === leader)!.alive = false;
  const later = beginWolfTeam(laterGame, 42, next.team.order);
  assert.equal(teamActor(later), team.participants[1]);
  assert.equal(later.plan, null);
  assert.equal(later.participants.includes(leader), false);
  assert.deepEqual(later.used, { primary: false, backup: false, consent: false });
});
