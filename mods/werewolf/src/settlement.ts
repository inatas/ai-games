import type { GameEvent } from '@game-ai/turn-based';
import {
  canShoot, hasLastWords, kill, transferBadge, verdict,
  type Chain, type GameState,
} from './rules.ts';

export type SettlementAction =
  | { kind: 'last-words'; text: string }
  | { kind: 'shot'; target: number | null }
  | { kind: 'badge-transfer'; target: number | null };

/** Persist with the MOD state; no closures, IO, or implicit timers. */
export interface Settlement {
  game: GameState;
  revision: number;
  queue: { kind: Chain; seat: number }[];
  deaths: number[];
  events: GameEvent[];
  complete: boolean;
  result: ReturnType<typeof verdict>;
}

function deathActions(game: GameState, seat: number): Settlement['queue'] {
  const subject = game.players.find(p => p.seat === seat);
  if (!subject || subject.alive || !subject.death) throw new Error('NOT_DEAD');
  if (!subject.death.announced) throw new Error('DEATH_NOT_ANNOUNCED');
  const queue: Settlement['queue'] = [];
  if (hasLastWords(game, seat)) queue.push({ kind: 'last-words', seat });
  if (canShoot(game, seat)) queue.push({ kind: 'shot', seat });
  if (game.sheriff === seat) queue.push({ kind: 'badge-transfer', seat });
  return queue;
}

function finish(settlement: Settlement): Settlement {
  settlement.complete = settlement.queue.length === 0;
  settlement.result = verdict(settlement.game, settlement.queue.map(item => item.kind));
  return settlement;
}

/** Caller supplies this batch's announced deaths in the phase machine's chosen order. */
export function beginSettlement(game: GameState, deaths: readonly number[]): Settlement {
  if (new Set(deaths).size !== deaths.length) throw new Error('DUPLICATE_DEATH');
  const queue = deaths.flatMap(seat => deathActions(game, seat));
  return finish({
    game: structuredClone(game), revision: 0, queue, deaths: [...deaths],
    events: [], complete: false, result: null,
  });
}

export function advanceSettlement(
  source: Settlement, expectedRevision: number, seat: number, action: SettlementAction,
): Settlement {
  if (expectedRevision !== source.revision) throw new Error('REVISION_CONFLICT');
  const current = source.queue[0];
  if (!current || source.complete) throw new Error('SETTLEMENT_COMPLETE');
  if (seat !== current.seat) throw new Error('WRONG_SETTLEMENT_ACTOR');
  if (!action || action.kind !== current.kind) throw new Error('WRONG_SETTLEMENT_ACTION');
  const expectedKeys = action.kind === 'last-words' ? 'kind,text' : 'kind,target';
  if (Object.keys(action).sort().join(',') !== expectedKeys) throw new Error('INVALID_SETTLEMENT_ACTION');
  const next = structuredClone(source);
  next.queue.shift();
  if (action.kind === 'last-words') {
    if (typeof action.text !== 'string' || [...action.text].length > 300) throw new Error('INVALID_SPEECH');
    next.events.push({ type: 'last-words', audience: 'public', data: { seat, text: action.text } });
  } else if (action.kind === 'shot') {
    if (!canShoot(next.game, seat)) throw new Error('CANNOT_SHOOT');
    if (action.target !== null) {
      next.game = kill(next.game, action.target, 'shot');
      next.deaths.push(action.target);
      // A target's death chain finishes before resuming the shooter's remaining actions.
      next.queue.unshift(...deathActions(next.game, action.target));
    }
    next.events.push({ type: 'hunter-shot', audience: 'public', data: { seat, target: action.target } });
  } else {
    next.game = transferBadge(next.game, seat, action.target);
    next.events.push({ type: 'badge-transfer', audience: 'public', data: { seat, target: action.target } });
  }
  next.revision++;
  return finish(next);
}
