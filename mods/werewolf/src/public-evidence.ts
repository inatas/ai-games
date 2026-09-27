import type { Json } from '@game-ai/core';
import type { Room } from '@game-ai/turn-based';

export const publicEvidenceVersion = 'e2';

type Event = Room['events'][number];
type Phase = NonNullable<Room['phaseHistory']>[number];
type Claim = { kind: 'role-claim' | 'inspection-claim' | 'save-claim' | 'silver-claim';
  quote: string; claimedRole?: 'seer' | 'witch'; targetSeat?: number; reportedAlignment?: 'good' | 'wolf' };
type Evidence = { record_kind: 'derived-public-evidence'; evidenceId: string;
  sourceSequences: number[]; day: number | null; phase: string; actorSeat: number;
  kind: Claim['kind'] | 'counterclaim' | 'no-extracted-counterclaim';
  status: 'claim' | 'observed-relation' | 'limited-observation'; quote: string;
  claimedRole?: 'seer' | 'witch'; targetSeat?: number; reportedAlignment?: 'good' | 'wolf';
  otherActorSeat?: number; windowId?: string; observedThroughPhaseInstance?: number };

const speechTypes = new Set(['speech', 'sheriff-speech', 'last-words']);
const speakingKeys = new Set(['speech', 'pk', 'election-speech', 'election-pk']);
const nextWindowKey: Record<string, string[]> = {
  speech: ['vote'], pk: ['vote'], 'election-speech': ['election-withdrawal', 'election-voting'],
  'election-pk': ['election-voting'],
};

function seat(raw: string): number | null {
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 && value <= 12 ? value : null;
}

function parseClaims(text: string): Claim[] {
  const claims: Claim[] = [];
  for (const part of text.split(/[，,。！？!?；;\n]/)) {
    const quote = part.trim();
    if (!quote || /不是|如果|假如|假设|可能|也许|听说|他说|她说|有人说|声称|自称|觉得|认为|猜|将来|准备|打算|但|不过|却|[“”"'「」]/.test(quote)) continue;
    const role = /^我(?:也)?(?:是|跳)(?:真)?(预言家|女巫)$/.exec(quote);
    if (role) { claims.push({ kind: 'role-claim', quote, claimedRole: role[1] === '预言家' ? 'seer' : 'witch' }); continue; }
    const inspection = /^(?:我查验(?:了)?(\d{1,2})号(?:是|为|结果是)(好人|狼人)|我给(\d{1,2})号发(金水|查杀)|(\d{1,2})号是我查验的(金水|查杀))$/.exec(quote);
    if (inspection) {
      const targetSeat = seat(inspection[1] ?? inspection[3] ?? inspection[5]);
      if (targetSeat !== null) claims.push({ kind: 'inspection-claim', quote, targetSeat,
        reportedAlignment: ['好人', '金水'].includes(inspection[2] ?? inspection[4] ?? inspection[6]) ? 'good' : 'wolf' });
      continue;
    }
    const save = /^(?:昨夜我救了(\d{1,2})号|(\d{1,2})号是我救的银水)$/.exec(quote);
    if (save) {
      const targetSeat = seat(save[1] ?? save[2]);
      if (targetSeat !== null) claims.push({ kind: 'save-claim', quote, targetSeat });
      continue;
    }
    const silver = /^我给(\d{1,2})号发银水$/.exec(quote);
    if (silver) {
      const targetSeat = seat(silver[1]);
      if (targetSeat !== null) claims.push({ kind: 'silver-claim', quote, targetSeat });
    }
  }
  const roles = new Set(claims.filter(claim => claim.kind === 'role-claim').map(claim => claim.claimedRole));
  const alignments = new Map<number, Set<string>>();
  for (const match of text.matchAll(/(\d{1,2})号[^，,。！？!?；;\n]{0,10}(好人|狼人|金水|查杀)/g)) {
    const target = seat(match[1]);
    if (target === null) continue;
    const set = alignments.get(target) ?? new Set<string>();
    set.add(['好人', '金水'].includes(match[2]) ? 'good' : 'wolf');
    alignments.set(target, set);
  }
  for (const claim of claims.filter(claim => claim.kind === 'inspection-claim')) {
    const set = alignments.get(claim.targetSeat!) ?? new Set<string>();
    set.add(claim.reportedAlignment!);
    alignments.set(claim.targetSeat!, set);
  }
  return claims.filter(claim => !(claim.kind === 'role-claim' && roles.size > 1) &&
    !(claim.kind === 'inspection-claim' && alignments.get(claim.targetSeat!)!.size > 1));
}

function windowFor(phases: Phase[], instance: number): { id: string; key: string; round: number; first: number } | null {
  const index = phases.findIndex(phase => phase.instance === instance);
  if (index < 0 || !speakingKeys.has(phases[index].key)) return null;
  const { key, round } = phases[index];
  let first = index;
  while (first > 0 && phases[first - 1].key === key && phases[first - 1].round === round) first--;
  return { id: `${round}:${key}:${phases[first].instance}`, key, round, first };
}

/** Public-only, deterministic projection. Derived records are never authoritative room events. */
export function buildPublicHistory(room: Room): Json[] {
  const phases = room.phaseHistory ?? [];
  const events = room.events.filter(event => event.audience === 'public');
  const timeline: { phase: number; order: number; value: Json }[] = [];
  const roleClaims = new Map<string, Evidence[]>();
  const ambiguous = new Set<string>();
  for (const event of events) {
    const data = event.data as { seat?: number; text?: string };
    timeline.push({ phase: event.phaseInstance, order: event.sequence,
      value: { sequence: event.sequence, type: event.type,
        record_kind: speechTypes.has(event.type) ? 'player-statement' : 'referee-result', data: event.data } });
    if (!speechTypes.has(event.type) || typeof data.text !== 'string' ||
      typeof data.seat !== 'number' || !Number.isInteger(data.seat)) continue;
    const phase = phases.find(item => item.instance === event.phaseInstance);
    const window = windowFor(phases, event.phaseInstance);
    const claims = parseClaims(data.text);
    const roleQuotes = new Set(claims.filter(claim => claim.kind === 'role-claim').map(claim => claim.quote));
    if (window && data.text.split(/[，,。！？!?；;\n]/).some(part =>
      /预言家|女巫/.test(part) && !roleQuotes.has(part.trim()))) ambiguous.add(window.id);
    for (const [index, claim] of claims.entries()) {
      const evidence: Evidence = { record_kind: 'derived-public-evidence',
        evidenceId: `${event.sequence}:${claim.kind}:${index}`, sourceSequences: [event.sequence],
        day: phase?.round ?? null, phase: phase?.key ?? event.type, actorSeat: data.seat,
        status: 'claim', ...claim };
      timeline.push({ phase: event.phaseInstance, order: event.sequence + (index + 1) / 100,
        value: evidence as unknown as Json });
      if (claim.kind !== 'role-claim' || !window) continue;
      const earlier = roleClaims.get(window.id) ?? [];
      for (const [pairIndex, other] of earlier.entries()) {
        if (other.actorSeat === data.seat || other.claimedRole !== claim.claimedRole) continue;
        const relation: Evidence = { record_kind: 'derived-public-evidence',
          evidenceId: `${event.sequence}:counterclaim:${other.sourceSequences[0]}:${pairIndex}`,
          sourceSequences: [other.sourceSequences[0], event.sequence], day: window.round,
          phase: window.key, actorSeat: data.seat, otherActorSeat: other.actorSeat,
          kind: 'counterclaim', status: 'observed-relation', quote: claim.quote,
          claimedRole: claim.claimedRole, windowId: window.id };
        timeline.push({ phase: event.phaseInstance, order: event.sequence + (index + 1) / 100 + (pairIndex + 1) / 10000,
          value: relation as unknown as Json });
      }
      earlier.push(evidence);
      roleClaims.set(window.id, earlier);
    }
  }
  const windows = new Map<string, ReturnType<typeof windowFor>>();
  for (const phase of phases) {
    const window = windowFor(phases, phase.instance);
    if (window) windows.set(window.id, window);
  }
  for (const window of windows.values()) {
    if (!window || ambiguous.has(window.id)) continue;
    let last = window.first;
    while (last + 1 < phases.length && phases[last + 1].key === window.key &&
      phases[last + 1].round === window.round) last++;
    const next = phases[last + 1];
    if (!next || !nextWindowKey[window.key]?.includes(next.key) ||
      events.some(event => event.type === 'wolf-explosion' &&
        event.phaseInstance >= phases[window.first].instance && event.phaseInstance <= phases[last].instance)) continue;
    const claims = roleClaims.get(window.id) ?? [];
    const emitted = new Set<string>();
    for (const claim of claims) {
      if (emitted.has(claim.claimedRole!)) continue;
      emitted.add(claim.claimedRole!);
      if (claims.some(other => other !== claim && other.claimedRole === claim.claimedRole &&
        other.actorSeat !== claim.actorSeat)) continue;
      const evidence: Evidence = { record_kind: 'derived-public-evidence',
        evidenceId: `${window.id}:no-counterclaim:${claim.sourceSequences[0]}`,
        sourceSequences: claim.sourceSequences, day: window.round, phase: window.key,
        actorSeat: claim.actorSeat, kind: 'no-extracted-counterclaim', status: 'limited-observation',
        quote: '截至本窗口结束，未识别到其他明确同身份声明',
        claimedRole: claim.claimedRole, windowId: window.id, observedThroughPhaseInstance: next.instance };
      timeline.push({ phase: next.instance, order: -1, value: evidence as unknown as Json });
    }
  }
  return timeline.sort((a, b) => a.phase - b.phase || a.order - b.order).map(item => item.value);
}
