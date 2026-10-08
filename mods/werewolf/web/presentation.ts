import type { DemoSnapshot } from '../shared/werewolf.ts';

export interface PresentationCursor { id: string; day: number; period: 'day' | 'night'; sequence: number; revision: number; phaseId?: string; observedSequence?: number }
export type ResultKind = 'sheriff' | 'no-sheriff' | 'exile' | 'no-exile' | 'night-deaths' | 'peaceful' | 'shot' | 'no-shot' | 'explosion' | 'idiot' | 'badge-transfer' | 'badge-lost';
export interface PresentationItem { id: string; kind: 'day' | 'night' | 'deaths' | 'campaign' | 'exile-vote' | 'result'; day: number; seats: number[]; phaseId?: string; result?: ResultKind }

export const motionTiming = { enter: 450, people: 1200, reveal: 350, hold: 2000, exit: 350, phase: 1800, sky: 2000 };
export function presentationMotion(item: PresentationItem, elapsed: number, reduced = false) {
  const duration = reduced ? (item.result ? motionTiming.hold : 300) : item.result
    ? motionTiming.people + motionTiming.reveal + motionTiming.hold + motionTiming.exit
    : item.kind === 'day' || item.kind === 'night' ? motionTiming.sky : motionTiming.phase;
  return { duration, people: reduced || elapsed >= motionTiming.people,
    exiting: elapsed >= duration - (reduced ? 0 : motionTiming.exit), done: elapsed >= duration };
}

export const resultCopy: Record<ResultKind, { title: string; art: string; detail?: string }> = {
  sheriff: { title: '当选警长', art: 'sheriff' },
  'no-sheriff': { title: '本局无警长', art: 'sheriff', detail: '无人当选' },
  exile: { title: '放逐出局', art: 'exile' },
  'no-exile': { title: '无人出局', art: 'exile', detail: '本轮无人被放逐' },
  'night-deaths': { title: '黑夜出局', art: 'grave' },
  peaceful: { title: '平安夜', art: 'peaceful', detail: '昨夜无人出局' },
  shot: { title: '猎人开枪', art: 'shot' },
  'no-shot': { title: '放弃开枪', art: 'no-shot', detail: '猎人放弃开枪' },
  explosion: { title: '狼人自爆', art: 'explosion' },
  idiot: { title: '白痴翻牌', art: 'idiot', detail: '免于放逐 · 失去投票资格' },
  'badge-transfer': { title: '警徽移交', art: 'sheriff' },
  'badge-lost': { title: '警徽流失', art: 'badge-lost', detail: '无人接任' },
};

function publicResult(event: DemoSnapshot['events'][number]): { result: ResultKind; seats: number[] } | null {
  const data = event.data as { seat: number | null; target: number | null; seats: number[]; winner: number | null; tied: number[] };
  switch (event.type) {
    case 'sheriff-result': return { result: data.seat === null ? 'no-sheriff' : 'sheriff', seats: data.seat === null ? [] : [data.seat] };
    case 'exiled': return { result: 'exile', seats: [data.seat!] };
    case 'idiot-revealed': return { result: 'idiot', seats: [data.seat!] };
    case 'night-deaths': return { result: data.seats.length ? 'night-deaths' : 'peaceful', seats: data.seats };
    case 'hunter-shot': return { result: data.target === null ? 'no-shot' : 'shot', seats: [data.target ?? data.seat!] };
    case 'wolf-explosion': return { result: 'explosion', seats: [data.seat!] };
    case 'badge-transfer': return { result: data.target === null ? 'badge-lost' : 'badge-transfer', seats: data.target === null ? [] : [data.seat!, data.target] };
    case 'exile-votes': return data.winner === null && data.tied.length === 0 ? { result: 'no-exile', seats: [] } : null;
    default: return null;
  }
}
export function nextPresentation(previous: PresentationCursor | null, game: DemoSnapshot, suppressed: boolean) {
  const sequence = Math.max(0, ...game.events.map(event => event.sequence));
  const cursor: PresentationCursor = { id: game.id, day: game.day, period: game.period, sequence, observedSequence: sequence, revision: game.revision, phaseId: game.phaseTransition?.id };
  const items: PresentationItem[] = [];
  if (!['running', 'finished'].includes(game.status) || game.id === 'preview') return { cursor, items };
  if (suppressed) {
    // A panel hides the announcement, but must not mark its public event as seen.
    if (previous?.id === game.id) cursor.sequence = previous.sequence;
    return { cursor, items };
  }
  if (!previous || previous.id !== game.id) {
    if (game.status === 'running' && game.revision === 0 && game.period === 'night') items.push({ id: game.id + ':start', kind: 'night', day: game.day, seats: [] });
    return { cursor, items };
  }
  // A reconnect catches up to the live scene rather than replaying old announcements.
  const caughtUp = game.revision - previous.revision > 3;
  const fresh = game.events.filter(event => event.sequence > previous.sequence && (event.day === game.day ||
    (event.day === previous.day && event.day + 1 === game.day && event.sequence > (previous.observedSequence ?? previous.sequence))))
    .sort((a, b) => a.sequence - b.sequence);
  const noSheriff = fresh.some(event => event.type === 'sheriff-result' && (event.data as { seat: number | null }).seat === null);
  for (const event of fresh) {
    const result = publicResult(event);
    if (!result || (result.result === 'badge-lost' && noSheriff)) continue;
    items.push({ id: `${game.id}:result:${event.sequence}`, kind: event.type === 'night-deaths' ? 'deaths' : 'result', day: event.day, ...result });
  }
  if (game.status === 'running' && !caughtUp && (game.period !== previous.period || game.day !== previous.day)) {
    items.push({ id: `${game.id}:${game.day}:${game.period}`, kind: game.period, day: game.day, seats: [] });
  }
  const phase = game.phaseTransition;
  if (game.status === 'running' && !caughtUp && game.period === 'day' && game.timing.remainingMs > 0 && phase && phase.id !== previous.phaseId) {
    items.push({ id: `${game.id}:phase:${phase.id}`, kind: phase.kind, phaseId: phase.id, day: game.day, seats: [] });
  }
  return { cursor, items };
}

export interface VoteData {
  ballots: { seat: number; target: number | null; kind: string }[];
  totals: { seat: number; votes: number }[];
  winner: number | null;
  tied: number[];
  sheriff: number | null;
  runoff?: boolean;
}

export function boardEvents(events: DemoSnapshot['events']): DemoSnapshot['events'] {
  return events.filter(event => !['speech', 'sheriff-speech', 'last-words'].includes(event.type));
}

export function boardVoteCopy(kind: 'sheriff' | 'exile', data: VoteData, day: number) {
  if (kind === 'sheriff') {
    const pk = !!data.runoff;
    return {
      title: `第${day}天 · ${pk ? '警长PK投票' : '警长竞选'}`,
      outcome: data.winner ? `${data.winner}号当选警长`
        : data.tied.length && !pk ? `${data.tied.join('、')}号平票，进入PK` : '警徽流失',
      ariaLabel: `第${day}天${pk ? '警长PK' : '警长竞选'}票型`,
    };
  }
  return {
    title: `第${day}天 · ${data.runoff ? 'PK投票' : '放逐投票'}`,
    outcome: data.winner ? `${data.winner}号得票最高`
      : data.tied.length ? `${data.tied.join('、')}号平票，进入PK` : '本轮无人出局',
    ariaLabel: `第${day}天${data.runoff ? 'PK' : ''}放逐票型`,
  };
}

export function summarizeVotes(data: VoteData) {
  const rows: { target: number | 'abstain' | 'missing'; voters: number[]; total: number }[] = data.totals
    .filter(total => data.ballots.some(ballot => ballot.target === total.seat))
    .sort((a, b) => b.votes - a.votes || a.seat - b.seat)
    .map(total => ({ target: total.seat, voters: data.ballots.filter(ballot => ballot.target === total.seat).map(ballot => ballot.seat).sort((a, b) => a - b), total: total.votes }));
  for (const kind of ['abstain', 'missing'] as const) {
    const voters = data.ballots.filter(ballot => ballot.kind === kind).map(ballot => ballot.seat).sort((a, b) => a - b);
    if (voters.length) rows.push({ target: kind, voters, total: 0 });
  }
  return rows;
}

