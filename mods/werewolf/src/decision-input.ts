import type { Json } from '@game-ai/core';
import { actorView, type DecisionInput, type DecisionOption, type Room, type RoomDefinition } from '@game-ai/turn-based';
import { nightActionSchema, type Match } from './match.ts';
import type { GameView } from './views.ts';
import { maxSpeechChars } from './speech-policy.ts';
import { currentBoardId, selectWerewolfKnowledge, werewolfKnowledge } from './knowledge.ts';
import type { Role } from './rules.ts';

interface ChoiceSchema {
  const?: Json;
  enum?: Json[];
  oneOf?: ChoiceSchema[];
  type?: string;
  properties?: Record<string, ChoiceSchema>;
}

type RoomEvent = Room['events'][number];

const privateActionTypes = new Set(['wolf-knife', 'wolf-choices', 'medicine', 'inspection']);
const speechTypes = new Set(['speech', 'sheriff-speech', 'last-words']);

function eventRound(room: Room, event: RoomEvent): number | null {
  return room.phaseHistory?.find(phase => phase.instance === event.phaseInstance)?.round ?? null;
}

function publicFact(event: RoomEvent) {
  return {
    sequence: event.sequence,
    type: event.type,
    record_kind: speechTypes.has(event.type) ? 'player-statement' : 'referee-result',
    data: event.data,
  };
}

function privateActionFact(room: Room, event: RoomEvent, publicEvents: RoomEvent[]): Json | null {
  const base = { sequence: event.sequence, type: event.type, data: event.data };
  if (event.type === 'wolf-choices') return { ...base, record_kind: 'team-ballot' };
  if (event.type === 'medicine') {
    const data = event.data as { action?: { kind?: string; target?: number }; target?: number };
    const action = data.action;
    const effect = action?.kind === 'pass' ? 'no-medicine-used'
      : action?.kind === 'save' ? 'antidote-applied' : 'poison-applied';
    const target = action?.kind === 'save' ? data.target : action?.kind === 'poison' ? action.target : undefined;
    const night = eventRound(room, event);
    const announcement = night === null ? undefined : publicEvents.find(candidate =>
      candidate.type === 'night-deaths' && eventRound(room, candidate) === night);
    return { ...base, result: { status: 'settled', effect,
      ...(typeof target === 'number' && announcement ? {
        target_alive_after_night: !(announcement.data as { seats: number[] }).seats.includes(target),
      } : {}),
    } };
  }
  if (event.type !== 'wolf-knife') return base;
  const { night, target } = event.data as { night: number; target: number | null };
  const announcement = publicEvents.find(candidate => candidate.type === 'night-deaths' && eventRound(room, candidate) === night);
  if (!announcement) return null;
  if (target === null) return { ...base, result: { status: 'settled', target_alive_after_night: null, caused_death: false } };
  const deaths = (announcement.data as { seats: number[] }).seats;
  const death = (room.state as unknown as Match).game.players.find(player => player.seat === target)?.death;
  const survivedNight = !deaths.includes(target);
  // In this ruleset a non-empty knife target only survives the night if the antidote cancelled the knife.
  return { ...base, result: {
    status: 'settled', target_alive_after_night: survivedNight,
    caused_death: deaths.includes(target) && death?.night === night && death.cause === 'knife',
    ...(survivedNight ? { saved_by_antidote: true } : {}),
  } };
}

function choices(schema: ChoiceSchema): Json[] {
  if ('const' in schema) return [schema.const!];
  if (schema.enum) return schema.enum;
  if (schema.oneOf) return schema.oneOf.flatMap(choices);
  if (schema.type === 'boolean') return [false, true];
  if (schema.type === 'object' && schema.properties) {
    let combinations: Record<string, Json>[] = [{}];
    for (const [key, property] of Object.entries(schema.properties)) {
      combinations = combinations.flatMap(partial => choices(property).map(value => ({ ...partial, [key]: value })));
    }
    return combinations;
  }
  throw new Error('UNSUPPORTED_DECISION_SCHEMA');
}

/** Pure, seat-authorized task construction. Full Match state is never serialized into the task. */
export function prepareWerewolfDecision(room: Room, seat: number, definition: RoomDefinition): DecisionInput {
  if (room.status !== 'running' || !room.phase?.actors.includes(seat)) throw new Error('INELIGIBLE_DECISION_ACTOR');
  const envelope = actorView(room, seat, definition) as unknown as {
    self: { seat: number; name: string };
    seats: { seat: number; name: string }[];
    state: GameView;
  };
  const events = room.events.filter(event => event.audience === 'public');
  const ownEvents = room.events.filter(event => Array.isArray(event.audience) &&
    event.audience.includes(seat) && privateActionTypes.has(event.type));
  const privateEvents = ownEvents.map(event => privateActionFact(room, event, events)).filter(event => event !== null);
  const pendingKnife = ownEvents.filter(event => event.type === 'wolf-knife').findLast(event =>
    !events.some(candidate => candidate.type === 'night-deaths' &&
      eventRound(room, candidate) === (event.data as { night: number }).night));
  const lastDeaths = events.filter(event => event.type === 'night-deaths').at(-1);
  const lastAnnouncedNight = lastDeaths ? {
    night: room.phaseHistory?.find(phase => phase.instance === lastDeaths.phaseInstance)?.round ?? room.phase.round,
    deaths: (lastDeaths.data as { seats: number[] }).seats,
    peaceful: (lastDeaths.data as { seats: number[] }).seats.length === 0,
  } : null;
  const { self: roleFacts, ...publicState } = envelope.state;
  const persona = room.seats.find(candidate => candidate.seat === seat)?.persona;
  if (!roleFacts) throw new Error('MISSING_ACTOR_FACTS');
  if ((room.state as unknown as Match).boardId !== currentBoardId) throw new Error('UNKNOWN_BOARD');
  const knowledge = selectWerewolfKnowledge(werewolfKnowledge, roleFacts.role as Role);
  const schema = room.phase.key === 'wolves'
    ? nightActionSchema(room.state as unknown as Match, seat) as ChoiceSchema
    : room.phase.schema as ChoiceSchema;
  const speech = schema.properties?.text?.type === 'string';
  const options: DecisionOption[] = speech ? [] : choices(schema).map((value, index) => ({ id: `option-${index}`, value }));
  const intent: DecisionInput['intent'] = speech ? 'SPEECH' : 'SELECT';
  const scene = room.phase.key;
  const spokenPhases = (room.phaseHistory ?? []).filter(phase =>
    phase.key === scene && phase.round === room.phase!.round && phase.instance <= room.phaseInstance);
  const micNo = speech ? spokenPhases.length || 1 : null;
  const currentAction = {
    request_type: intent as DecisionInput['intent'], scene,
    options: options.map(option => ({ id: option.id, value: option.value })),
    phaseInstance: room.phaseInstance,
    ...(room.phaseActionDeadlineAt === undefined ? {} : { deadlineAt: room.phaseActionDeadlineAt }),
    publicEventWatermark: events.length,
  };
  return {
    actor: { roomId: room.id, seat, phaseInstance: room.phaseInstance }, intent, scene, options,
    ...knowledge,
    audit: { seatNo: seat, micNo, role: roleFacts.role, phaseInstance: room.phaseInstance,
      publicEventWatermark: events.length },
    outputSchema: speech
      ? { type: 'object', additionalProperties: false, required: ['speech'], properties: { speech: { type: 'string', minLength: 1, maxLength: maxSpeechChars } } }
      : { type: 'object', additionalProperties: false, required: ['selected'], properties: { selected: { enum: options.map(option => option.id) } } },
    context: {
      rules: {
        version: definition.version,
        fact_boundaries: 'game_state是当前公开状态；public_history中的发言只证明该玩家说过这些话，不证明发言内容属实。已公布的逐人投票目标是裁判事实；private_information只包含本人或本方获授权的已执行操作与结果，current_intel是尚待结算的当前情报，不是历史结果。动作与当前结算状态冲突时以当前状态为准，不能把刀口当作实际死亡。',
      },
      game_state: { ...publicState, seats: envelope.seats, phase: { key: scene, round: room.phase.round }, last_announced_night: lastAnnouncedNight },
      self: { ...envelope.self, role: roleFacts.role, ...(persona ? { persona } : {}) },
      private_information: { ...roleFacts, events: privateEvents,
        ...(pendingKnife ? { current_intel: { kind: 'wolf-knife-target',
          ...(pendingKnife.data as { night: number; target: number | null }), outcome: 'pending' } } : {}) },
      public_history: events.map(publicFact),
      current_action: currentAction,
    },
  };
}
