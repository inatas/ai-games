export type Role = 'wolf' | 'villager' | 'seer' | 'witch' | 'hunter' | 'idiot';
/** Single authoritative roster for the current playable board. */
export const BOARD_ROLES: readonly Role[] = ['wolf', 'wolf', 'wolf', 'wolf', 'villager', 'villager',
  'villager', 'villager', 'seer', 'witch', 'hunter', 'idiot'];
export type DeathCause = 'knife' | 'poison' | 'exile' | 'shot' | 'explode';
export type Chain = 'last-words' | 'shot' | 'badge-transfer';
export interface Player {
  seat: number;
  role: Role;
  alive: boolean;
  revealed: boolean;
  death: { cause: DeathCause; night: number; announced: boolean } | null;
}
/** Private MOD state. Never serialize directly to a spectator or another seat. */
export interface GameState {
  players: Player[];
  night: number;
  random: number;
  sheriff: number | null;
  antidote: boolean;
  poison: boolean;
  medicineNight: number | null;
  inspections: { night: number; target: number; alignment: 'wolf' | 'good' }[];
}
export interface Ballot { seat: number; target: number | null }
export interface VoteOptions {
  kind: 'exile' | 'sheriff';
  voters: number[];
  candidates: number[];
  runoff?: boolean;
}
export type Medicine = { kind: 'save' } | { kind: 'poison'; target: number } | { kind: 'pass' };

function requireRule(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}
function player(state: GameState, seat: number): Player {
  const found = state.players.find(p => p.seat === seat);
  requireRule(found, 'INVALID_SEAT');
  return found;
}
function living(state: GameState, seat: number): Player {
  const found = player(state, seat);
  requireRule(found.alive, 'PLAYER_DEAD');
  return found;
}
function unique(seats: readonly number[]): void {
  requireRule(new Set(seats).size === seats.length, 'DUPLICATE_SEAT');
}
/** Deterministic PRNG; state is returned/persisted with the game, never global. */
function draw(state: GameState, count: number): number {
  requireRule(count > 0, 'EMPTY_DRAW');
  state.random = (state.random + 0x6d2b79f5) >>> 0;
  let value = state.random;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return Math.floor(((value ^ (value >>> 14)) >>> 0) / 4294967296 * count);
}

export function createGame(seed: number): GameState {
  requireRule(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff, 'INVALID_SEED');
  const state: GameState = {
    players: [], night: 1, random: seed, sheriff: null,
    antidote: true, poison: true, medicineNight: null, inspections: [],
  };
  const roles: Role[] = [...BOARD_ROLES];
  for (let index = roles.length - 1; index > 0; index--) {
    const other = draw(state, index + 1);
    [roles[index], roles[other]] = [roles[other], roles[index]];
  }
  state.players = roles.map((role, index) => ({ seat: index + 1, role, alive: true, revealed: false, death: null }));
  return state;
}

export function resolveWolfKnife(source: GameState, ballots: readonly Ballot[]) {
  const wolves = source.players.filter(p => p.alive && p.role === 'wolf');
  unique(ballots.map(b => b.seat));
  requireRule(ballots.length === wolves.length && ballots.every(b => wolves.some(p => p.seat === b.seat)), 'INVALID_WOLF_BALLOTS');
  const totals = new Map<number, number>();
  for (const ballot of ballots) {
    if (ballot.target === null) continue;
    living(source, ballot.target);
    totals.set(ballot.target, (totals.get(ballot.target) ?? 0) + 1);
  }
  const state = structuredClone(source);
  if (!totals.size) return { state, target: null };
  const highest = Math.max(...totals.values());
  const candidates = [...totals].filter(([, votes]) => votes === highest).map(([seat]) => seat).sort((a, b) => a - b);
  return { state, target: candidates.length === 1 ? candidates[0] : candidates[draw(state, candidates.length)] };
}

export function useMedicine(source: GameState, seat: number, knife: number | null, action: Medicine) {
  requireRule(living(source, seat).role === 'witch', 'NOT_WITCH');
  requireRule(source.medicineNight !== source.night, 'MEDICINE_ALREADY_DECIDED');
  if (knife !== null) living(source, knife);
  requireRule(action && ['save', 'poison', 'pass'].includes(action.kind), 'INVALID_MEDICINE');
  const keys = Object.keys(action).sort().join(',');
  requireRule(keys === (action.kind === 'poison' ? 'kind,target' : 'kind'), 'INVALID_MEDICINE');
  const state = structuredClone(source);
  state.medicineNight = state.night;
  let poison: number | null = null;
  if (action.kind === 'save') {
    requireRule(state.antidote && knife !== null && knife !== seat, 'INVALID_SAVE');
    state.antidote = false;
    knife = null;
  } else if (action.kind === 'poison') {
    requireRule(state.poison, 'POISON_SPENT');
    living(state, action.target);
    state.poison = false;
    poison = action.target;
  }
  return { state, knife, poison };
}

export function inspectSeat(source: GameState, seat: number, target: number) {
  requireRule(living(source, seat).role === 'seer', 'NOT_SEER');
  const last = source.inspections.at(-1);
  requireRule(!last || (last.night !== source.night && !(last.night === source.night - 1 && last.target === target)), 'REPEATED_INSPECTION');
  const alignment = living(source, target).role === 'wolf' ? 'wolf' : 'good';
  const state = structuredClone(source);
  state.inspections.push({ night: state.night, target, alignment });
  return { state, alignment };
}

/** Low-level death operation; the phase machine owns action timing and the chain queue. */
export function kill(source: GameState, seat: number, cause: DeathCause): GameState {
  if (cause === 'explode') requireRule(electionEligible(source, seat), 'PLAYER_DEAD');
  else living(source, seat);
  const state = structuredClone(source);
  const victim = player(state, seat);
  victim.alive = false;
  victim.death = { cause, night: state.night, announced: true };
  if (cause === 'explode') {
    requireRule(victim.role === 'wolf', 'NOT_WOLF');
    if (state.sheriff === seat) state.sheriff = null;
  }
  return state;
}

/** Resolve the entire night together so poison overrides knife regardless of input order. */
export function settleNight(source: GameState, knife: number | null, poison: number | null): GameState {
  let state = structuredClone(source);
  const targets = [...new Set([knife, poison].filter((seat): seat is number => seat !== null))].sort((a, b) => a - b);
  for (const seat of targets) {
    state = kill(state, seat, seat === poison ? 'poison' : 'knife');
    player(state, seat).death!.announced = false;
  }
  return state;
}

export function announceDeaths(source: GameState): GameState {
  const state = structuredClone(source);
  for (const victim of state.players) if (victim.death) victim.death.announced = true;
  return state;
}

export function electionEligible(state: GameState, seat: number): boolean {
  const candidate = player(state, seat);
  return candidate.alive || !!candidate.death && !candidate.death.announced;
}

export function exile(source: GameState, seat: number): GameState {
  const victim = living(source, seat);
  requireRule(!victim.revealed, 'IDIOT_NOT_ELIGIBLE');
  if (victim.role !== 'idiot') return kill(source, seat, 'exile');
  const state = structuredClone(source);
  player(state, seat).revealed = true;
  return state;
}

export function canShoot(state: GameState, seat: number): boolean {
  const hunter = player(state, seat);
  return hunter.role === 'hunter' && !hunter.alive && (hunter.death?.cause === 'knife' || hunter.death?.cause === 'exile');
}

export function hasLastWords(state: GameState, seat: number): boolean {
  const death = player(state, seat).death;
  if (!death) return false;
  if (death.cause === 'explode') return false;
  if (death.cause === 'exile' || death.cause === 'shot') return true;
  return death.night === 1;
}

export function transferBadge(source: GameState, seat: number, target: number | null): GameState {
  const sheriff = player(source, seat);
  requireRule(source.sheriff === seat && !sheriff.alive && sheriff.death?.announced && sheriff.death.cause !== 'explode', 'INVALID_BADGE_TRANSFER');
  if (target !== null) living(source, target);
  return { ...structuredClone(source), sheriff: target };
}

export function tallyVotes(state: GameState, votes: readonly Ballot[], options: VoteOptions) {
  const { kind, voters, candidates, runoff } = options;
  unique(voters);
  unique(candidates);
  unique(votes.map(v => v.seat));
  for (const seat of [...voters, ...candidates]) {
    const subject = player(state, seat);
    requireRule(kind === 'sheriff' ? electionEligible(state, seat) : subject.alive && !subject.revealed, 'INELIGIBLE_VOTE');
  }
  if (kind === 'sheriff' || runoff) requireRule(voters.every(seat => !candidates.includes(seat)), 'CANDIDATE_CANNOT_VOTE');
  for (const vote of votes) {
    requireRule(voters.includes(vote.seat), 'INVALID_VOTER');
    requireRule(vote.target === null || candidates.includes(vote.target), 'INVALID_VOTE_TARGET');
  }
  const ballots = voters.map(seat => {
    const vote = votes.find(v => v.seat === seat);
    return { seat, target: vote?.target ?? null, kind: !vote ? 'missing' : vote.target === null ? 'abstain' : 'vote' };
  });
  const totals = [...candidates].sort((a, b) => a - b).map(seat => ({
    seat, votes: votes.filter(v => v.target === seat).reduce((sum, vote) => sum + (kind === 'exile' && vote.seat === state.sheriff ? 1.5 : 1), 0),
  }));
  const max = Math.max(0, ...totals.map(t => t.votes));
  const leaders = totals.filter(t => t.votes === max && max > 0).map(t => t.seat);
  const winner = kind === 'sheriff' && candidates.length === 1 ? candidates[0] : leaders.length === 1 ? leaders[0] : null;
  return { winner, tied: winner === null && !runoff && leaders.length > 1 ? leaders : [], totals, ballots };
}

/** Call with the phase machine's remaining chains, including non-death actions. */
export function verdict(state: GameState, pendingChains: readonly Chain[] = []) {
  if (pendingChains.length) return null;
  const alive = state.players.filter(p => p.alive);
  const goodWins = !alive.some(p => p.role === 'wolf');
  const villagersGone = !alive.some(p => p.role === 'villager');
  const godsGone = !alive.some(p => p.role !== 'wolf' && p.role !== 'villager');
  if (goodWins && (villagersGone || godsGone)) return { winner: 'draw', reason: 'both-conditions' } as const;
  if (goodWins) return { winner: 'good', reason: 'wolves-eliminated' } as const;
  if (villagersGone || godsGone) return { winner: 'wolf', reason: villagersGone ? 'villagers-eliminated' : 'gods-eliminated' } as const;
  return null;
}

export function speakingOrder(source: GameState, deaths: readonly number[], direction: 'clockwise' | 'counterclockwise' = 'counterclockwise') {
  unique(deaths);
  for (const seat of deaths) requireRule(!player(source, seat).alive, 'INVALID_DEATH_ANCHOR');
  const state = structuredClone(source);
  const alive = state.players.filter(p => p.alive).map(p => p.seat).sort((a, b) => a - b);
  requireRule(alive.length, 'NO_SPEAKERS');
  const anchors = [...deaths].sort((a, b) => a - b);
  const anchor = anchors.length ? anchors[anchors.length === 1 ? 0 : draw(state, anchors.length)] : null;
  const start = anchor ?? alive[draw(state, alive.length)];
  const step = direction === 'clockwise' ? 1 : -1;
  const seats: number[] = [];
  for (let index = anchor === null ? 0 : 1; index < (anchor === null ? 12 : 13); index++) {
    const seat = ((start - 1 + step * index) % 12 + 12) % 12 + 1;
    if (alive.includes(seat)) seats.push(seat);
  }
  return { state, anchor, seats };
}
