import { Ajv } from 'ajv';
import type { Json } from '@game-ai/core';
import type { GameEvent, Phase } from '@game-ai/turn-based';
import {
  createGame, resolveWolfKnife, useMedicine, inspectSeat, settleNight, announceDeaths,
  electionEligible, speakingOrder, tallyVotes, exile, kill,
  type GameState, type Ballot, type Medicine,
} from './rules.ts';
import { beginElection, electionAllowsExplosion, advanceElection, explodeElection, resumeElection, type Election, type ElectionAction, type SheriffMode } from './election.ts';
import { beginSettlement, advanceSettlement, type Settlement, type SettlementAction } from './settlement.ts';
import { maxSpeechChars } from './speech-policy.ts';

export type MatchStage = 'wolves' | 'witch' | 'nominations' | 'election'
  | 'settlement' | 'direction' | 'speech' | 'vote' | 'pk' | 'finished';
export interface MatchOptions { seed: number; sheriff: SheriffMode }
export interface Match {
  game: GameState;
  mode: SheriffMode;
  stage: MatchStage;
  revision: number;
  pending: number[];
  choices: Ballot[];
  nominations: number[];
  knife: number | null;
  poison: number | null;
  nightDeaths: number[];
  runoff: number[];
  election: Election | null;
  settlement: Settlement | null;
  afterSettlement: 'day' | 'night';
  events: GameEvent[];
  result: Settlement['result'];
}
type MatchAction = Medicine | ElectionAction | SettlementAction
  | { kind: 'knife' | 'inspect'; target: number | null }
  | { kind: 'nominate'; run: boolean }
  | { kind: 'direction'; direction: 'clockwise' | 'counterclockwise' };
const ajv = new Ajv({ strict: true, allErrors: true });
const alive = (state: Match) => state.game.players.filter(p => p.alive);
const roleSeat = (state: Match, role: string) => alive(state).find(p => p.role === role)?.seat;
const speechSchema = { type: 'string', maxLength: maxSpeechChars };
function actionSchema(kind: string, properties: Record<string, object> = {}): object {
  return { type: 'object', additionalProperties: false, required: ['kind', ...Object.keys(properties)],
    properties: { kind: { const: kind }, ...properties } };
}
const targetSchema = (seats: number[], nullable = true) => ({ enum: nullable ? [...seats, null] : seats });

export function createMatch(options: MatchOptions): Match {
  if (!['double', 'single', 'none'].includes(options.sheriff)) throw new Error('INVALID_SHERIFF_MODE');
  const state: Match = {
    game: createGame(options.seed), mode: options.sheriff, stage: 'wolves', revision: 0,
    pending: [], choices: [], nominations: [], knife: null, poison: null, nightDeaths: [], runoff: [],
    election: null, settlement: null, afterSettlement: 'day', events: [], result: null,
  };
  state.pending = alive(state).filter(p => p.role === 'wolf' || p.role === 'seer').map(p => p.seat);
  return state;
}

function startNight(state: Match): void {
  state.game.night++;
  state.stage = 'wolves';
  state.pending = alive(state).filter(p => p.role === 'wolf' || p.role === 'seer').map(p => p.seat);
  state.choices = [];
  state.knife = null;
  state.poison = null;
  state.nightDeaths = [];
  state.runoff = [];
  state.settlement = null;
}

function startSpeech(state: Match, direction: 'clockwise' | 'counterclockwise'): void {
  const order = speakingOrder(state.game, state.nightDeaths, direction);
  state.game = order.state;
  state.stage = 'speech';
  state.pending = order.seats;
  state.events.push({ type: 'speaking-order', audience: 'public', data: { seats: order.seats, direction } });
}

function afterChains(state: Match): void {
  const settlement = state.settlement!;
  state.game = settlement.game;
  if (!settlement.complete) { state.stage = 'settlement'; return; }
  if (settlement.result) {
    state.result = settlement.result;
    state.stage = 'finished';
    state.pending = [];
    state.events.push({ type: 'game-result', audience: 'public', data: settlement.result });
  } else if (state.afterSettlement === 'night') startNight(state);
  else if (state.game.sheriff !== null) {
    state.stage = 'direction'; state.pending = [state.game.sheriff];
  } else startSpeech(state, 'counterclockwise');
}

function startChains(state: Match, deaths: number[], next: 'day' | 'night'): void {
  state.afterSettlement = next;
  state.settlement = beginSettlement(state.game, deaths);
  afterChains(state);
}

function absorbElection(state: Match, election: Election, eventOffset: number, interrupted = false): void {
  state.events.push(...election.events.slice(eventOffset));
  state.election = election;
  state.game = election.game;
  if (election.stage === 'finished' || election.stage === 'suspended') {
    startChains(state, election.deaths, interrupted || election.stage === 'suspended' ? 'night' : 'day');
  } else state.stage = 'election';
}

function dawn(state: Match): void {
  state.game = settleNight(state.game, state.knife, state.poison);
  state.nightDeaths = state.game.players.filter(p => p.death && !p.death.announced).map(p => p.seat);
  if (state.election?.stage === 'suspended') {
    const old = state.election;
    absorbElection(state, resumeElection(old, old.revision, state.game), old.events.length);
  } else if (state.game.night === 1 && state.mode !== 'none') {
    state.stage = 'nominations';
    state.nominations = [];
    state.pending = state.game.players.filter(p => electionEligible(state.game, p.seat)).map(p => p.seat);
  } else {
    state.game = announceDeaths(state.game);
    state.events.push({ type: 'night-deaths', audience: 'public', data: { seats: state.nightDeaths } });
    startChains(state, state.nightDeaths, 'day');
  }
}

function finishNightChoices(state: Match): void {
  if (state.pending.length) return;
  const resolved = resolveWolfKnife(state.game, state.choices);
  state.game = resolved.state; state.knife = resolved.target;
  state.events.push({ type: 'wolf-knife', audience: state.game.players.filter(p => p.alive && p.role === 'wolf').map(p => p.seat), data: { night: state.game.night, target: resolved.target } });
  state.events.push({ type: 'wolf-choices', audience: state.game.players.filter(p => p.role === 'wolf').map(p => p.seat), data: state.choices as unknown as Json });
  const witch = roleSeat(state, 'witch');
  if (witch !== undefined) { state.stage = 'witch'; state.pending = [witch]; }
  else dawn(state);
}

export function nightActionSchema(state: Match, seat: number): object {
  const livingSeats = alive(state).map(p => p.seat);
  if (state.game.players.find(p => p.seat === seat)?.role === 'seer') {
    const last = state.game.inspections.at(-1);
    return actionSchema('inspect', { target: targetSchema(livingSeats.filter(target => !(last?.night === state.game.night - 1 && last.target === target)), false) });
  }
  return actionSchema('knife', { target: targetSchema(livingSeats) });
}

function startVote(state: Match): void {
  state.stage = 'vote';
  state.choices = [];
  state.pending = alive(state).filter(p => !p.revealed && !state.runoff.includes(p.seat)).map(p => p.seat);
  if (!state.pending.length) startNight(state);
}

export function explosionActors(state: Match): number[] {
  const allowed = state.stage === 'election' ? electionAllowsExplosion(state.election!)
    : ['speech', 'pk', 'vote'].includes(state.stage);
  return allowed ? state.game.players.filter(p => p.role === 'wolf' && electionEligible(state.game, p.seat)).map(p => p.seat) : [];
}

export function matchPhase(state: Match): Phase | null {
  if (state.stage === 'finished') return null;
  const livingSeats = alive(state).map(p => p.seat);
  let actors = state.pending;
  let mode: Phase['mode'] = 'sequential';
  let schema: object;
  let key: string = state.stage;
  let label = '公开发言';
  switch (state.stage) {
    case 'wolves':
      schema = { oneOf: [actionSchema('knife', { target: targetSchema(livingSeats) }), actionSchema('inspect', { target: targetSchema(livingSeats, false) })] };
      mode = 'sealed'; label = '夜间行动'; break;
    case 'witch': {
      const options = [actionSchema('pass')];
      if (state.game.antidote && state.knife !== null && state.knife !== actors[0]) options.push(actionSchema('save'));
      if (state.game.poison) options.push(actionSchema('poison', { target: targetSchema(livingSeats, false) }));
      schema = { oneOf: options }; label = '夜间行动'; break;
    }
    case 'nominations': schema = actionSchema('nominate', { run: { type: 'boolean' } }); mode = 'sealed'; label = '上警报名'; break;
    case 'direction': schema = actionSchema('direction', { direction: { enum: ['clockwise', 'counterclockwise'] } }); label = '发言方向'; break;
    case 'speech': case 'pk': schema = actionSchema('speak', { text: speechSchema }); break;
    case 'vote': schema = actionSchema('vote', { target: targetSchema(state.runoff.length ? state.runoff : alive(state).filter(p => !p.revealed).map(p => p.seat)) }); mode = 'sealed'; label = '放逐投票'; break;
    case 'election': {
      const election = state.election!;
      key = `election-${election.stage}`;
      label = election.stage === 'withdrawal' ? '警长退水' : '警长竞选';
      actors = election.pending;
      if (election.stage === 'voting') {
        mode = 'sealed'; schema = actionSchema('vote', { target: targetSchema(election.candidates) });
      } else if (election.stage === 'withdrawal') {
        mode = 'sealed'; schema = actionSchema('withdraw', { withdraw: { type: 'boolean' } });
      }
      else schema = actionSchema('speak', { text: speechSchema });
      break;
    }
    case 'settlement': {
      const item = state.settlement!.queue[0];
      actors = [item.seat]; key = item.kind; label = item.kind === 'last-words' ? '遗言' : item.kind === 'shot' ? '猎人开枪' : '移交警徽';
      schema = item.kind === 'last-words' ? actionSchema(item.kind, { text: speechSchema })
        : actionSchema(item.kind, { target: targetSchema(livingSeats) });
      break;
    }
  }
  if (!actors.length) throw new Error('EMPTY_MATCH_PHASE');
  const interruptActors = explosionActors(state);
  const interrupt = interruptActors.length ? { key: 'self-explosion', actors: interruptActors,
    schema: { type: 'object', additionalProperties: false, required: ['kind'], properties: { kind: { enum: ['pass', 'explode'] } } },
  } : undefined;
  return { ...(interrupt ? { interrupt } : {}), key, label, round: state.game.night, mode, actors: mode === 'sealed' ? [...actors] : actors.slice(0, 1), schema };
}

export function decideMatch(source: Match, revision: number, seat: number, value: Json): Match {
  if (revision !== source.revision) throw new Error('REVISION_CONFLICT');
  const phase = matchPhase(source);
  if (!phase || !phase.actors.includes(seat)) throw new Error('INELIGIBLE_MATCH_ACTOR');
  if (!ajv.compile(phase.schema)(value)) throw new Error('INVALID_MATCH_ACTION');
  if (source.stage === 'wolves' && !ajv.compile(nightActionSchema(source, seat))(value)) throw new Error('INVALID_ROLE_ACTION');
  const action = value as unknown as MatchAction;
  const state = structuredClone(source);
  state.revision++;
  state.pending = state.pending.filter(actor => actor !== seat);
  switch (action.kind) {
    case 'knife': {
      state.choices.push({ seat, target: action.target });
      finishNightChoices(state);
      break;
    }
    case 'save': case 'poison': case 'pass': {
      const savedTarget = action.kind === 'save' ? state.knife : null;
      const used = useMedicine(state.game, seat, state.knife, action);
      state.game = used.state; state.knife = used.knife; state.poison = used.poison;
      state.events.push({ type: 'medicine', audience: [seat], data: {
        seat, action, ...(action.kind === 'save' ? { target: savedTarget } : {}),
      } });
      dawn(state); break;
    }
    case 'inspect': {
      const inspected = inspectSeat(state.game, seat, action.target!);
      state.game = inspected.state;
      state.events.push({ type: 'inspection', audience: [seat], data: { target: action.target, alignment: inspected.alignment } });
      finishNightChoices(state); break;
    }
    case 'nominate':
      if (action.run) state.nominations.push(seat);
      if (!state.pending.length) absorbElection(state, beginElection(state.game, state.nominations, state.mode), 0);
      break;
    case 'direction':
      startSpeech(state, action.direction); break;
    default:
      if (state.stage === 'election') {
        const election = state.election!;
        absorbElection(state, advanceElection(election, election.revision, seat, action as ElectionAction), election.events.length);
      } else if (state.stage === 'settlement') {
        const settlement = state.settlement!;
        const next = advanceSettlement(settlement, settlement.revision, seat, action as SettlementAction);
        state.events.push(...next.events.slice(settlement.events.length));
        state.settlement = next;
        afterChains(state);
      } else if (action.kind === 'speak') {
        state.events.push({ type: 'speech', audience: 'public', data: { seat, text: action.text, runoff: state.runoff.length > 0 } });
        if (!state.pending.length) startVote(state);
      } else if (action.kind === 'vote') {
        state.choices.push({ seat, target: action.target });
        if (!state.pending.length) {
          const candidates = state.runoff.length ? state.runoff : alive(state).filter(p => !p.revealed).map(p => p.seat);
          const result = tallyVotes(state.game, state.choices, { kind: 'exile', candidates, voters: state.choices.map(v => v.seat), runoff: state.runoff.length > 0 });
          state.events.push({ type: 'exile-votes', audience: 'public', data: { ...result, sheriff: state.game.sheriff, runoff: state.runoff.length > 0 } as unknown as Json });
          if (result.tied.length) {
            state.runoff = result.tied; state.stage = 'pk'; state.pending = [...result.tied];
          } else if (result.winner !== null) {
            state.game = exile(state.game, result.winner);
            const victim = state.game.players.find(p => p.seat === result.winner)!;
            state.events.push({ type: victim.alive ? 'idiot-revealed' : 'exiled', audience: 'public', data: { seat: result.winner } });
            startChains(state, victim.alive ? [] : [result.winner], 'night');
          } else startNight(state);
        }
      }
  }
  return state;
}

/** Pure transition used by the independent interrupt lane. */
export function explodeMatch(source: Match, revision: number, seat: number): Match {
  if (revision !== source.revision) throw new Error('REVISION_CONFLICT');
  if (!explosionActors(source).includes(seat)) throw new Error('EXPLOSION_NOT_ALLOWED');
  const state = structuredClone(source);
  state.revision++;
  if (state.stage === 'election') {
    const election = state.election!;
    absorbElection(state, explodeElection(election, election.revision, seat), election.events.length, true);
  } else if (['speech', 'pk', 'vote'].includes(state.stage)) {
    state.game = kill(state.game, seat, 'explode');
    state.events.push({ type: 'wolf-explosion', audience: 'public', data: { seat } });
    startChains(state, [seat], 'night');
  } else throw new Error('EXPLOSION_NOT_ALLOWED');
  return state;
}
