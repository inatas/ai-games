import type { GameEvent } from '@game-ai/turn-based';
import { announceDeaths, electionEligible, kill, tallyVotes, type Ballot, type GameState } from './rules.ts';

export type SheriffMode = 'double' | 'single' | 'none';
export type ElectionStage = 'speech' | 'withdrawal' | 'voting' | 'pk' | 'suspended' | 'finished';
export type ElectionAction =
  | { kind: 'speak'; text: string }
  | { kind: 'withdraw'; withdraw: boolean }
  | { kind: 'vote'; target: number | null };

/** Private, serializable MOD state. Never expose ballots through the public projection. */
export interface Election {
  game: GameState;
  mode: SheriffMode;
  stage: ElectionStage;
  revision: number;
  registered: number[];
  candidates: number[];
  pending: number[];
  ballots: Ballot[];
  runoff: boolean;
  firstExplosionNight: number | null;
  events: GameEvent[];
  /** Current batch, handed to the settlement queue before proceeding to another night. */
  deaths: number[];
}

function checkRevision(election: Election, revision: number): void {
  if (election.revision !== revision) throw new Error('REVISION_CONFLICT');
}

function publishDeaths(election: Election, exploded: number | null = null): void {
  const nightDeaths = election.game.players.filter(p => p.death && !p.death.announced).map(p => p.seat);
  election.deaths = [...nightDeaths, ...(exploded === null ? [] : [exploded])].sort((a, b) => a - b);
  election.game = announceDeaths(election.game);
  election.events.push({ type: 'night-deaths', audience: 'public', data: { seats: nightDeaths } });
}

function complete(election: Election, winner: number | null): void {
  election.stage = 'finished';
  election.pending = [];
  election.game.sheriff = winner;
  election.events.push({ type: 'sheriff-result', audience: 'public', data: { seat: winner } });
  publishDeaths(election);
}

function finishIfUncontested(election: Election): boolean {
  if (election.candidates.length > 1) return false;
  complete(election, election.candidates[0] ?? null);
  return true;
}

function beginVoting(election: Election): void {
  if (finishIfUncontested(election)) return;
  election.stage = 'voting';
  election.ballots = [];
  election.pending = election.game.players
    .filter(p => electionEligible(election.game, p.seat) && !election.registered.includes(p.seat))
    .map(p => p.seat);
  if (!election.pending.length) complete(election, null);
}

/** Nominations have already been collected; do not infer missing nominations as opt-outs. */
export function beginElection(game: GameState, nominations: readonly number[], mode: SheriffMode = 'double'): Election {
  if (!['double', 'single', 'none'].includes(mode)) throw new Error('INVALID_SHERIFF_MODE');
  if (game.sheriff !== null) throw new Error('SHERIFF_ALREADY_ELECTED');
  if (new Set(nominations).size !== nominations.length) throw new Error('DUPLICATE_CANDIDATE');
  for (const seat of nominations) {
    if (!game.players.some(p => p.seat === seat) || !electionEligible(game, seat)) throw new Error('INELIGIBLE_CANDIDATE');
  }
  if (mode === 'none' && nominations.length) throw new Error('ELECTION_DISABLED');
  const registered = [...nominations].sort((a, b) => a - b);
  const election: Election = {
    game: structuredClone(game), mode, stage: 'speech', revision: 0,
    registered, candidates: [...registered], pending: [...registered],
    ballots: [], runoff: false, firstExplosionNight: null, events: [], deaths: [],
  };
  if (mode !== 'none') election.events.push({ type: 'sheriff-candidates', audience: 'public', data: { seats: registered } });
  finishIfUncontested(election);
  return election;
}

export function advanceElection(source: Election, revision: number, seat: number, action: ElectionAction): Election {
  checkRevision(source, revision);
  const expected = source.stage === 'speech' || source.stage === 'pk' ? 'speak'
    : source.stage === 'withdrawal' ? 'withdraw' : source.stage === 'voting' ? 'vote' : null;
  if (!action || !expected || action.kind !== expected) throw new Error('WRONG_ELECTION_ACTION');
  if (!source.pending.includes(seat) || (source.stage !== 'voting' && source.pending[0] !== seat)) {
    throw new Error('INELIGIBLE_ELECTION_ACTOR');
  }
  const keys = action.kind === 'speak' ? 'kind,text' : action.kind === 'withdraw' ? 'kind,withdraw' : 'kind,target';
  if (Object.keys(action).sort().join(',') !== keys) throw new Error('INVALID_ELECTION_ACTION');
  const election = structuredClone(source);
  election.pending = election.pending.filter(actor => actor !== seat);
  if (action.kind === 'speak') {
    if (typeof action.text !== 'string' || [...action.text].length > 300) throw new Error('INVALID_SPEECH');
    election.events.push({ type: 'sheriff-speech', audience: 'public', data: { seat, text: action.text, runoff: election.runoff } });
    if (!election.pending.length) {
      if (election.runoff) beginVoting(election);
      else {
        election.stage = 'withdrawal';
        election.pending = [...election.candidates];
      }
    }
  } else if (action.kind === 'withdraw') {
    if (typeof action.withdraw !== 'boolean') throw new Error('INVALID_WITHDRAWAL');
    if (action.withdraw) {
      election.candidates = election.candidates.filter(candidate => candidate !== seat);
      election.events.push({ type: 'sheriff-withdrawal', audience: 'public', data: { seat } });
    }
    if (!finishIfUncontested(election) && !election.pending.length) beginVoting(election);
  } else {
    if (action.target !== null && !election.candidates.includes(action.target)) throw new Error('INVALID_VOTE_TARGET');
    election.ballots.push({ seat, target: action.target });
    election.events.push({ type: 'sheriff-ballot', audience: 'after-game', data: { seat, target: action.target, runoff: election.runoff } });
    if (!election.pending.length) {
      const result = tallyVotes(election.game, election.ballots, {
        kind: 'sheriff', voters: election.ballots.map(v => v.seat), candidates: election.candidates, runoff: election.runoff,
      });
      if (result.tied.length) {
        election.candidates = result.tied;
        election.pending = [...result.tied];
        election.stage = 'pk';
        election.runoff = true;
        election.events.push({ type: 'sheriff-pk', audience: 'public', data: { seats: result.tied } });
      } else complete(election, result.winner);
    }
  }
  election.revision++;
  return election;
}

export function electionAllowsExplosion(election: Election): boolean {
  const continuing = election.firstExplosionNight !== null && election.game.night > election.firstExplosionNight;
  return ['speech', 'withdrawal', 'pk'].includes(election.stage) || (election.stage === 'voting' && continuing);
}

/** Immediate rules transition, independent of the scheduled speaker; runtime dispatch is separate. */
export function explodeElection(source: Election, revision: number, seat: number): Election {
  checkRevision(source, revision);
  const continuing = source.firstExplosionNight !== null && source.game.night > source.firstExplosionNight;
  if (!electionAllowsExplosion(source)) {
    throw new Error('EXPLOSION_NOT_ALLOWED');
  }
  const election = structuredClone(source);
  election.game = kill(election.game, seat, 'explode');
  election.events.push({ type: 'wolf-explosion', audience: 'public', data: { seat } });
  const losesBadge = election.mode === 'single' || continuing;
  if (losesBadge) {
    election.stage = 'finished';
    election.game.sheriff = null;
    election.events.push({ type: 'sheriff-result', audience: 'public', data: { seat: null } });
  } else {
    election.stage = 'suspended';
    election.firstExplosionNight = election.game.night;
  }
  election.pending = [];
  election.ballots = [];
  publishDeaths(election, seat);
  election.revision++;
  return election;
}

/** Host has completed the previous death chains and the intervening night. */
export function resumeElection(source: Election, revision: number, game: GameState): Election {
  checkRevision(source, revision);
  if (source.stage !== 'suspended') throw new Error('ELECTION_NOT_SUSPENDED');
  if (source.firstExplosionNight === null || game.night <= source.firstExplosionNight) throw new Error('NEXT_NIGHT_REQUIRED');
  const election = structuredClone(source);
  election.game = structuredClone(game);
  election.candidates = election.candidates.filter(seat => electionEligible(game, seat));
  election.stage = 'withdrawal';
  election.pending = [...election.candidates];
  election.deaths = [];
  election.ballots = [];
  election.revision++;
  finishIfUncontested(election);
  return election;
}
