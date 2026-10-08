import type { Json } from '@game-ai/core';
import type { DecisionOrigin, Phase } from '@game-ai/turn-based';
import { matchPhase, decideMatch, type Match } from './match.ts';
import { advanceWolfTeam, beginWolfTeam, parseTeamResponse, teamActor } from './wolf-team.ts';
import { maxSpeechChars } from './speech-policy.ts';

const actionSchema = (kind: string, properties: Record<string, object> = {}, optional: string[] = []) => ({
  type: 'object', additionalProperties: false,
  required: ['kind', ...Object.keys(properties).filter(key => !optional.includes(key))],
  properties: { kind: { const: kind }, ...properties },
});
export const isTeamPhase = (key: string | undefined) => key?.startsWith('wolf-team-') === true;

/** New nights replace suggestions; actual past publications remain in the authorized history. */
export function syncWolfTeam(match: Match, seed: number): void {
  if (match.stage !== 'wolves' || match.wolfTeam?.night === match.game.night) return;
  const prior = match.wolfTeam;
  if (prior?.plan) match.events.push({ type: 'wolf-team-plan', audience: [...prior.participants],
    data: { ...prior.plan, status: 'expired' } as unknown as Json });
  match.wolfTeam = beginWolfTeam(match.game, seed, prior?.order);
  if (!match.wolfTeam.participants.length) match.wolfTeam.step = 'done';
}

export function teamMatchPhase(match: Match): Phase | null {
  const team = match.wolfTeam;
  if (match.stage !== 'wolves' || !team || team.step === 'done') {
    const phase = matchPhase(match);
    // Only the robot-facing envelope carries the optional response; base game actions stay unchanged.
    if (phase?.key === 'wolves') {
      const schema = structuredClone(phase.schema) as { oneOf: { properties: Record<string, object> }[] };
      const knife = schema.oneOf.find(item => (item.properties.kind as { const: string }).const === 'knife');
      if (knife) knife.properties.teamResponse = {};
      return { ...phase, schema };
    }
    return phase;
  }
  const actor = teamActor(team)!;
  const schema = team.step === 'wait' ? actionSchema('team-wait') : team.step === 'consent'
    ? actionSchema('team-consent', { accepted: { type: 'boolean' }, planId: { const: team.plan!.planId },
      version: { const: team.plan!.version }, close: { type: 'boolean' } }, ['close'])
    : actionSchema('team-proposal', { text: { type: 'string', maxLength: maxSpeechChars }, proposal: {},
      reason: { type: ['string', 'null'] }, close: { type: 'boolean' } }, ['close']);
  return { key: team.step === 'wait' ? 'wolf-team-wait' : team.step === 'consent'
    ? 'wolf-team-self-knife-consent' : 'wolf-team-proposal', label: '夜间准备', round: match.game.night,
    mode: 'sequential', actors: [actor], schema, windowGroup: `wolf-team:${team.night}` };
}

export function advanceTeamMatch(source: Match, seat: number, value: Json, origin: DecisionOrigin): Match {
  const match = structuredClone(source);
  const team = match.wolfTeam!;
  const action = value as { kind: string; text?: string; proposal?: unknown; accepted?: boolean;
    reason?: string; close?: boolean; planId?: string; version?: number };
  if (teamActor(team) !== seat) throw new Error('TEAM_ACTOR_CONFLICT');
  if (action.close) {
    if (origin !== 'default') throw new Error('TEAM_CLOSE_ORIGIN');
    team.step = 'done';
    match.events.push({ type: 'wolf-team-deadline', audience: [...team.participants], data: { night: team.night } });
  } else if (team.step === 'wait' && action.kind === 'team-wait') team.step = 'done';
  else {
    if ((team.step === 'consent' && (action.kind !== 'team-consent' ||
      action.planId !== team.plan?.planId || action.version !== team.plan?.version)) ||
      (team.step !== 'consent' && action.kind !== 'team-proposal')) throw new Error('TEAM_ACTION_CONFLICT');
    const result = advanceWolfTeam(team, match.game, seat, action, origin);
    match.wolfTeam = result.team;
    match.events.push(...result.events);
  }
  match.revision++;
  return match;
}

export function baseTeamAction(value: Json): Json {
  const action = structuredClone(value) as Record<string, Json>;
  delete action.teamResponse;
  return action;
}

/** Called only when the ordinary sealed wolf phase resolves, never per incoming ballot. */
export function decideWithTeam(match: Match, seat: number, value: Json, origin: DecisionOrigin): Match {
  const action = value as { kind?: string; target?: number | null; teamResponse?: unknown };
  if (match.stage === 'wolves' && action.kind === 'knife' && match.wolfTeam) {
    const next = structuredClone(match);
    const team = next.wolfTeam!;
    const response = origin === 'default' ? null : parseTeamResponse(action.teamResponse, team.plan, seat);
    next.events.push({ type: 'wolf-team-response', audience: [...team.participants], data: {
      night: team.night, seat, origin, knifeTarget: action.target ?? null,
      planId: team.plan?.planId ?? null, version: team.plan?.version ?? null,
      sameKnife: team.plan?.status === 'proposed' && team.plan.payload.knifeTarget === action.target,
      adoptedKnife: origin !== 'default' && team.plan?.status === 'proposed' && team.plan.payload.knifeTarget === action.target,
      assignment: response as unknown as Json,
    } });
    return decideMatch(next, next.revision, seat, baseTeamAction(value));
  }
  return decideMatch(match, match.revision, seat, baseTeamAction(value));
}
