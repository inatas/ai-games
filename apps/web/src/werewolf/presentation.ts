import type { DemoSnapshot } from '../../../shared/werewolf.ts';

export interface PresentationCursor { id: string; day: number; period: 'day' | 'night'; sequence: number; revision: number }
export interface PresentationItem { id: string; kind: 'day' | 'night' | 'deaths'; day: number; seats: number[] }
export function nextPresentation(previous: PresentationCursor | null, game: DemoSnapshot, suppressed: boolean) {
  const sequence = Math.max(0, ...game.events.map(event => event.sequence));
  const cursor: PresentationCursor = { id: game.id, day: game.day, period: game.period, sequence, revision: game.revision };
  const items: PresentationItem[] = [];
  if (suppressed || game.status !== 'running' || game.id === 'preview') return { cursor, items };
  if (!previous || previous.id !== game.id) {
    if (game.revision === 0 && game.period === 'night') items.push({ id: game.id + ':start', kind: 'night', day: game.day, seats: [] });
    return { cursor, items };
  }
  // A reconnect catches up to the live scene rather than replaying old announcements.
  if (game.revision - previous.revision > 3) return { cursor, items };
  if (game.period !== previous.period || game.day !== previous.day) {
    items.push({ id: `${game.id}:${game.day}:${game.period}`, kind: game.period, day: game.day, seats: [] });
  }
  for (const event of game.events) {
    if (event.sequence > previous.sequence && event.type === 'night-deaths' && event.day === game.day) {
      items.push({ id: `${game.id}:deaths:${event.sequence}`, kind: 'deaths', day: event.day, seats: (event.data as { seats: number[] }).seats });
    }
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

