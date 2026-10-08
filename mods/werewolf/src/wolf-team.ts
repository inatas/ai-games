import { createHash } from 'node:crypto';
import type { Json } from '@game-ai/core';
import type { GameEvent } from '@game-ai/turn-based';
import type { GameState } from './rules.ts';
import { exactKeys, isRecord, roleId, seatNumber, shortText } from './decision-memory.ts';

export type TeamOrigin = 'model' | 'script' | 'rule' | 'default' | 'external';
export interface TeamProposal {
  knifeTarget: number | null;
  assignments: { seat: number; tactic: string; claimedRole: string | null; instruction: string }[];
  conditions: string;
  selfKnifeConsent: boolean;
}
export interface TeamResponse { planId: string; version: number; assignmentStance: 'accept' | 'adjust' | 'reject'; note: string }
export interface TeamPlan {
  night: number; planId: string; version: number; status: 'proposed' | 'superseded' | 'expired';
  organizer: number; participants: number[]; payload: TeamProposal;
  consent: { seat: number; accepted: boolean; origin: TeamOrigin } | null;
}
export interface WolfTeam {
  night: number; order: number[]; participants: number[];
  step: 'primary' | 'backup' | 'consent' | 'wait' | 'done';
  used: { primary: boolean; backup: boolean; consent: boolean };
  normalOnly: boolean; plan: TeamPlan | null;
}

export function beginWolfTeam(game: GameState, seed: number, previousOrder?: number[]): WolfTeam {
  const wolves = game.players.filter(p => p.role === 'wolf').map(p => p.seat);
  const order = previousOrder ? [...previousOrder] : [...wolves].sort((a, b) => {
    const key = (seat: number) => createHash('sha256').update(`wolf-organizer:${seed}:${seat}`).digest().readUInt32BE(0);
    return key(a) - key(b) || a - b;
  });
  return { night: game.night, order,
    participants: order.filter(seat => game.players.some(p => p.seat === seat && p.role === 'wolf' && p.alive)),
    step: 'primary', used: { primary: false, backup: false, consent: false }, normalOnly: false, plan: null };
}

export function teamActor(team: WolfTeam): number | null {
  if (team.step === 'consent') return team.plan?.payload.knifeTarget ?? null;
  if (team.step === 'done') return null;
  return team.participants[team.step === 'backup' ? 1 : 0] ?? null;
}

export function parseTeamProposal(raw: unknown, game: GameState, team: WolfTeam, actor: number): TeamProposal | null {
  if (!isRecord(raw) || !exactKeys(raw, ['knifeTarget', 'assignments', 'conditions', 'selfKnifeConsent']) ||
      !(raw.knifeTarget === null || (seatNumber(raw.knifeTarget) && game.players.some(p => p.seat === raw.knifeTarget && p.alive))) ||
      !Array.isArray(raw.assignments) || raw.assignments.length > 4 || !shortText(raw.conditions, 120) ||
      typeof raw.selfKnifeConsent !== 'boolean' || (raw.selfKnifeConsent && raw.knifeTarget !== actor) ||
      (team.normalOnly && team.participants.includes(raw.knifeTarget as number))) return null;
  const seen = new Set<number>();
  for (const item of raw.assignments) {
    if (!isRecord(item) || !exactKeys(item, ['seat', 'tactic', 'claimedRole', 'instruction']) ||
        !seatNumber(item.seat) || !team.participants.includes(item.seat) || seen.has(item.seat) ||
        !shortText(item.tactic, 24, true) || !roleId(item.claimedRole) || !shortText(item.instruction, 80, true)) return null;
    seen.add(item.seat);
  }
  return structuredClone(raw) as unknown as TeamProposal;
}

export function parseTeamResponse(raw: unknown, plan: TeamPlan | null, actor: number): TeamResponse | null {
  if (!isRecord(raw) || !exactKeys(raw, ['planId', 'version', 'assignmentStance', 'note']) ||
      !plan || plan.status !== 'proposed' || raw.planId !== plan.planId || raw.version !== plan.version ||
      !plan.payload.assignments.some(item => item.seat === actor) ||
      !['accept', 'adjust', 'reject'].includes(raw.assignmentStance as string) || !shortText(raw.note, 100)) return null;
  return structuredClone(raw) as unknown as TeamResponse;
}

/** Selection restrictions are robot tactics; the game's base self-knife rule is unchanged. */
export function permittedWolfTargets(game: GameState, team: WolfTeam, actor: number): number[] {
  return game.players.filter(p => p.alive && (p.role !== 'wolf' || p.seat === actor ||
    (team.plan?.status === 'proposed' && team.plan.night === game.night &&
      team.plan.payload.knifeTarget === p.seat && team.plan.consent?.accepted && team.plan.consent.seat === p.seat)))
    .map(p => p.seat);
}

/** A bounded, pure MOD state machine. Provider waiting and clocks belong to the runtime. */
export function advanceWolfTeam(source: WolfTeam, game: GameState, actor: number,
  action: { text?: string; proposal?: unknown; accepted?: boolean; reason?: string | null }, origin: TeamOrigin,
): { team: WolfTeam; events: GameEvent[] } {
  if (source.step === 'wait' || source.step === 'done' || teamActor(source) !== actor || source.used[source.step]) throw new Error('TEAM_STEP_CONFLICT');
  const team = structuredClone(source);
  const slot = team.step as 'primary' | 'backup' | 'consent';
  team.used[slot] = true;
  const events: GameEvent[] = [];
  const emit = (type: string, data: unknown) => events.push({ type, audience: [...team.participants], data: data as Json });
  const backupOrWait = (normalOnly: boolean) => {
    team.normalOnly ||= normalOnly;
    team.step = !team.used.backup && team.participants.length > 1 ? 'backup' : 'wait';
  };
  emit('wolf-team-call', { night: team.night, seat: actor, slot, origin, reason: action.reason ?? null });
  if (slot === 'consent') {
    const accepted = origin !== 'default' && action.accepted === true;
    team.plan!.consent = { seat: actor, accepted, origin };
    emit('wolf-team-consent', { planId: team.plan!.planId, version: team.plan!.version, ...team.plan!.consent });
    if (accepted) team.step = 'wait'; else backupOrWait(true);
    return { team, events };
  }
  if (action.text?.trim()) emit('wolf-team-speech', { night: team.night, seat: actor, text: action.text });
  const payload = origin === 'default' ? null : parseTeamProposal(action.proposal, game, team, actor);
  if (!payload) {
    backupOrWait(false);
    return { team, events };
  }
  const previousVersion = team.plan?.version ?? 0;
  if (team.plan) emit('wolf-team-plan', { ...team.plan, status: 'superseded' });
  team.plan = { night: team.night, planId: `wolf-team:${team.night}`, version: previousVersion + 1,
    status: 'proposed', organizer: actor, participants: [...team.participants], payload, consent: null };
  emit('wolf-team-plan', team.plan);
  if (!team.participants.includes(payload.knifeTarget as number)) team.step = 'wait';
  else if (payload.knifeTarget === actor) {
    if (payload.selfKnifeConsent) {
      team.plan.consent = { seat: actor, accepted: true, origin };
      emit('wolf-team-consent', { planId: team.plan.planId, version: team.plan.version, ...team.plan.consent });
      team.step = 'wait';
    } else backupOrWait(true);
  } else if (!team.used.consent) team.step = 'consent';
  else backupOrWait(true);
  return { team, events };
}
