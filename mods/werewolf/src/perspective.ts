import { projectGame } from './views.ts';
import type { Match } from './match.ts';
import type { Role } from './rules.ts';

export type Perspective = { kind: 'public' } | {
  kind: 'seat'; seat: number; role: Role; wolves?: number[];
  inspections?: { night: number; target: number; alignment: 'good' | 'wolf' }[];
  medicine?: { antidote: boolean; poison: boolean }; knife?: number | null;
  knives?: { night: number; target: number | null }[];
  deaths: { seat: number; cause: 'knife' | 'poison' }[];
};

export function projectPerspective(match: Match, viewer: number | null): Perspective {
  if (viewer === null) return { kind: 'public' };
  if (!Number.isInteger(viewer) || viewer < 1 || viewer > 12) throw new Error('INVALID_VIEWER');
  const phase = match.stage === 'wolves' || match.stage === 'witch' ? match.stage : 'day';
  const self = projectGame(match.game, viewer, { phase, knife: match.knife }).self!;
  const result: Extract<Perspective, { kind: 'seat' }> = { kind: 'seat', seat: viewer, role: self.role, deaths: [] };
  if (self.wolves) result.wolves = self.wolves;
  if (self.inspections) result.inspections = self.inspections;
  if (self.medicine) result.medicine = self.medicine;
  if ('knife' in self) result.knife = self.knife;
  const known = match.events.filter(event => Array.isArray(event.audience) && event.audience.includes(viewer));
  if (self.role === 'wolf') result.knives = known.filter(e => e.type === 'wolf-knife').map(e => e.data as { night: number; target: number | null });
  for (const player of match.game.players) {
    const death = player.death;
    if (!death?.announced) continue;
    const knifeKnown = death.cause === 'knife' && result.knives?.some(k => k.night === death.night && k.target === player.seat);
    const poisonKnown = self.role === 'witch' && death.cause === 'poison' && known.some(e => {
      if (e.type !== 'medicine') return false;
      const data = e.data as { action: { kind: string; target?: number } };
      return data.action.kind === 'poison' && data.action.target === player.seat;
    });
    if (knifeKnown || poisonKnown) result.deaths.push({ seat: player.seat, cause: knifeKnown ? 'knife' : 'poison' });
  }
  return result;
}
