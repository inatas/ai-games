import { canShoot, type GameState, type Role } from './rules.ts';

export interface ViewContext {
  phase: 'night' | 'wolves' | 'witch' | 'seer' | 'day';
  /** Server-only, supplied only for the current night. */
  knife?: number | null;
}
export interface GameView {
  night: number;
  period: 'night' | 'day';
  sheriff: number | null;
  players: { seat: number; alive: boolean; revealedRole?: 'idiot' }[];
  self?: {
    seat: number;
    role: Role;
    wolves?: number[];
    inspections?: GameState['inspections'];
    medicine?: { antidote: boolean; poison: boolean };
    knife?: number | null;
    canShoot?: boolean;
  };
}

/** Build an allowlisted projection; event visibility remains owned by turn-based. */
export function projectGame(game: GameState, viewer: number | null, context: ViewContext): GameView {
  const view: GameView = {
    night: game.night,
    period: context.phase === 'day' ? 'day' : 'night',
    sheriff: game.sheriff,
    players: game.players.map(p => ({
      seat: p.seat,
      alive: p.alive || !!p.death && !p.death.announced,
      ...(p.revealed ? { revealedRole: 'idiot' as const } : {}),
    })),
  };
  if (viewer === null) return view;
  const self = game.players.find(p => p.seat === viewer);
  if (!self) throw new Error('INVALID_VIEWER');
  view.self = { seat: viewer, role: self.role };
  switch (self.role) {
    case 'wolf':
      view.self.wolves = game.players.filter(p => p.role === 'wolf').map(p => p.seat);
      break;
    case 'seer':
      view.self.inspections = game.inspections.map(({ night, target, alignment }) => ({ night, target, alignment }));
      break;
    case 'witch':
      view.self.medicine = { antidote: game.antidote, poison: game.poison };
      if (context.phase === 'witch' && game.antidote && self.alive) {
        if (context.knife === undefined) throw new Error('MISSING_KNIFE_CONTEXT');
        view.self.knife = context.knife;
      }
      break;
    case 'hunter':
      view.self.canShoot = canShoot(game, viewer);
      break;
  }
  return view;
}

/** Trusted RoomDefinition.reveal callback only; framework gates it on normal finish. */
export function revealGame(game: GameState) {
  return {
    players: game.players.map(({ seat, role, death }) => ({ seat, role, death: death ? { ...death } : null })),
    inspections: game.inspections.map(({ night, target, alignment }) => ({ night, target, alignment })),
    medicine: { antidote: game.antidote, poison: game.poison },
  };
}
