import { canonical, type Json } from '@game-ai/core';
import { parsePersonalEvidenceUpdate } from './personal-evidence.ts';
import { BOARD_ROLES } from './rules.ts';

export const decisionMemoryKey = 'werewolf.decision-memory.v2';
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
export const exactKeys = (value: Record<string, unknown>, expected: string[]) =>
  Object.keys(value).sort().join(',') === [...expected].sort().join(',');
export const shortText = (value: unknown, max: number, required = false): value is string =>
  typeof value === 'string' && [...value].length <= max && (!required || !!value.trim());
export const seatNumber = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= 12;
export const roleId = (value: unknown) => value === null || (BOARD_ROLES as readonly unknown[]).includes(value);

function validStrategy(raw: unknown, facts: Record<string, unknown>, previous: unknown): raw is Json {
  if (!isRecord(raw) || !exactKeys(raw, ['tactic', 'claimedRole', 'intendedReports', 'voteTarget', 'nextStep', 'changeReason', 'teamPlanRef']) ||
      !shortText(raw.tactic, 24, true) || !roleId(raw.claimedRole) ||
      !Array.isArray(raw.intendedReports) || raw.intendedReports.length > 4 ||
      !(raw.voteTarget === null || seatNumber(raw.voteTarget)) ||
      !shortText(raw.nextStep, 80, true) || !shortText(raw.changeReason, 60)) return false;
  const seen = new Set<string>();
  for (const report of raw.intendedReports) {
    if (!isRecord(report) || !exactKeys(report, ['night', 'targetSeat', 'alignment']) ||
        !Number.isSafeInteger(report.night) || (report.night as number) < 1 || !seatNumber(report.targetSeat) ||
        !['good', 'wolf'].includes(report.alignment as string)) return false;
    const key = `${report.night}:${report.targetSeat}`;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  if (raw.teamPlanRef !== null) {
    const ref = raw.teamPlanRef;
    const info = facts.private_information;
    const plan = isRecord(info) ? info.team_plan : null;
    if (!isRecord(ref) || !exactKeys(ref, ['planId', 'version']) || !shortText(ref.planId, 128, true) ||
        !Number.isSafeInteger(ref.version) || (ref.version as number) < 1 || !isRecord(plan) || plan.status !== 'proposed' ||
        ref.planId !== plan.planId || ref.version !== plan.version) return false;
  }
  if (isRecord(previous) && ['tactic', 'claimedRole', 'intendedReports'].some(key =>
    canonical(raw[key] as Json) !== canonical(previous[key] as Json)) && !raw.changeReason.trim()) return false;
  return true;
}

/** Optional views and optional intent are independent, neither certifies game facts. */
export function parseDecisionMemoryUpdate(proposal: Json, facts: Json, previous: Json | null): Json | null {
  if (!isRecord(proposal) || !isRecord(facts) ||
      (previous !== null && (!isRecord(previous) || !Array.isArray(previous.entries)))) return null;
  const old = previous === null ? { entries: [] as Json[], strategy: null as Json } : previous as { entries: Json[]; strategy: Json };
  const evidence = parsePersonalEvidenceUpdate(proposal, facts, previous) as { entries: Json[] } | null;
  let strategy = old.strategy ?? null;
  const update = proposal.strategy_update;
  if (isRecord(update) && exactKeys(update, ['set']) &&
      (update.set === null || validStrategy(update.set, facts, strategy))) strategy = structuredClone(update.set as Json);
  const next = { entries: evidence?.entries ?? old.entries, strategy };
  return canonical(next) === canonical(old) ? null : next;
}
