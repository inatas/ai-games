import type { DemoSnapshot } from '../../../shared/werewolf.ts';

export type DeathDisplay = 'night' | 'exile' | 'shot' | 'explode' | 'knife' | 'poison';
export function publicSeatState(seat: number, alive: boolean, events: DemoSnapshot['events'], election: boolean) {
  let death: DeathDisplay | null = null;
  let nominated = false;
  for (const event of events) {
    const data = event.data as { seat?: number; target?: number; seats?: number[] };
    if (event.type === 'sheriff-candidates') nominated = data.seats?.includes(seat) ?? false;
    if (event.type === 'sheriff-withdrawal' && data.seat === seat) nominated = false;
    if (alive) continue;
    if (event.type === 'night-deaths' && data.seats?.includes(seat)) death = 'night';
    if (event.type === 'exiled' && data.seat === seat) death = 'exile';
    if (event.type === 'hunter-shot' && data.target === seat) death = 'shot';
    if (event.type === 'wolf-explosion' && data.seat === seat) death = 'explode';
  }
  return { death, nominated: election && nominated };
}
