import type { DemoSnapshot } from '../../../shared/werewolf.ts';
import type { VoteData } from './presentation.ts';

type Event = DemoSnapshot['events'][number];
type Base = { sequence: number; day: number; period: 'day' | 'night' };
export type HistoryItem = Base & (
  | { kind: 'speech'; phase: string; seat: number; text: string }
  | { kind: 'vote'; election: 'sheriff' | 'exile'; data: VoteData }
  | { kind: 'announcement'; text: string }
  | { kind: 'wolf-choices'; choices: { seat: number; target: number | null }[] }
  | { kind: 'wolf-knife'; target: number | null }
  | { kind: 'inspection'; target: number; alignment: 'good' | 'wolf' }
  | { kind: 'medicine'; seat: number; action: { kind: string; target?: number }; knifeTarget: number | null }
);

function orderedEvents(game: DemoSnapshot): Event[] {
  if (game.status !== 'finished' || !game.replay?.length) return game.events;
  const events = game.replay.flatMap(frame => frame.events).sort((a, b) => a.sequence - b.sequence);
  // Night roles act concurrently. Group their completed records in the approved
  // review order, independent of the order in which the referee appended events.
  const nightOrder = ['wolf-choices', 'wolf-knife', 'medicine', 'inspection'];
  for (const night of new Set(events.filter(event => event.period === 'night').map(event => event.day))) {
    const indexes = events.flatMap((event, index) => event.day === night && event.period === 'night' && nightOrder.includes(event.type) ? [index] : []);
    const actions = indexes.map(index => events[index]).sort((a, b) => nightOrder.indexOf(a.type) - nightOrder.indexOf(b.type));
    indexes.forEach((index, position) => { events[index] = actions[position]; });
  }
  return events;
}

export function buildHistoryTimeline(game: DemoSnapshot): HistoryItem[] {
  const events = orderedEvents(game);
  const finished = game.status === 'finished';
  const knifeByNight = new Map<number, number | null>();
  if (finished) for (const event of events) if (event.type === 'wolf-knife') {
    knifeByNight.set(event.day, (event.data as { target: number | null }).target);
  }
  const hasSheriffVotes = new Set(events.filter(event => event.type === 'sheriff-votes').map(event => event.day));
  const hasExileVotes = new Set(events.filter(event => event.type === 'exile-votes').map(event => event.day));
  const items: HistoryItem[] = [];
  for (const event of events) {
    const base = { sequence: event.sequence, day: event.day, period: event.type === 'night-deaths' ? 'day' as const : event.period };
    const data = event.data as Record<string, unknown>;
    if (['speech', 'sheriff-speech', 'last-words'].includes(event.type)) {
      const text = data.text;
      const seat = data.seat;
      if (typeof text !== 'string' || !text.trim() || typeof seat !== 'number') continue;
      const phase = event.type === 'sheriff-speech' ? (data.runoff ? '警长PK发言' : '上警发言')
        : event.type === 'last-words' ? '遗言' : typeof data.phase === 'string' ? data.phase : '放逐发言';
      items.push({ ...base, kind: 'speech', phase, seat, text });
    } else if (event.type === 'sheriff-votes' || event.type === 'exile-votes') {
      items.push({ ...base, kind: 'vote', election: event.type === 'sheriff-votes' ? 'sheriff' : 'exile', data: event.data as unknown as VoteData });
    } else if (event.type === 'night-deaths') {
      const seats = Array.isArray(data.seats) ? data.seats as number[] : [];
      items.push({ ...base, kind: 'announcement', text: seats.length ? `昨夜 ${seats.map(seat => `${seat}号`).join('、')} 出局` : '昨夜平安夜，无人出局' });
    } else if (event.type === 'sheriff-result' && !hasSheriffVotes.has(event.day)) {
      items.push({ ...base, kind: 'announcement', text: typeof data.seat === 'number' ? `${data.seat}号当选警长` : '警徽流失 · 本局无警长' });
    } else if (event.type === 'exiled' && !hasExileVotes.has(event.day)) {
      items.push({ ...base, kind: 'announcement', text: typeof data.seat === 'number' ? `${data.seat}号被放逐出局` : '本轮无人出局' });
    } else if (finished && event.type === 'wolf-choices') {
      items.push({ ...base, kind: 'wolf-choices', choices: event.data as { seat: number; target: number | null }[] });
    } else if (finished && event.type === 'wolf-knife') {
      items.push({ ...base, kind: 'wolf-knife', target: data.target as number | null });
    } else if (finished && event.type === 'inspection') {
      items.push({ ...base, kind: 'inspection', target: data.target as number, alignment: data.alignment as 'good' | 'wolf' });
    } else if (finished && event.type === 'medicine') {
      items.push({ ...base, kind: 'medicine', seat: data.seat as number,
        action: data.action as { kind: string; target?: number }, knifeTarget: knifeByNight.get(event.day) ?? null });
    }
  }
  return items;
}

export function filterHistoryTimeline(items: HistoryItem[], day: number | 'all'): HistoryItem[] {
  return day === 'all' ? items : items.filter(item => item.day === day);
}
