import type { Json } from '@game-ai/core';
import { actorView, type DecisionInput, type DecisionOption, type Room, type RoomDefinition } from '@game-ai/turn-based';
import { nightActionSchema, type Match } from './match.ts';
import type { GameView } from './views.ts';

interface ChoiceSchema {
  const?: Json;
  enum?: Json[];
  oneOf?: ChoiceSchema[];
  type?: string;
  properties?: Record<string, ChoiceSchema>;
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
  const ownEvents = room.events.filter(event => Array.isArray(event.audience) && event.audience.includes(seat));
  const lastDeaths = events.filter(event => event.type === 'night-deaths').at(-1);
  const lastAnnouncedNight = lastDeaths ? {
    night: room.phaseHistory?.find(phase => phase.instance === lastDeaths.phaseInstance)?.round ?? room.phase.round,
    deaths: (lastDeaths.data as { seats: number[] }).seats,
    peaceful: (lastDeaths.data as { seats: number[] }).seats.length === 0,
  } : null;
  const { self: roleFacts, ...publicState } = envelope.state;
  const persona = room.seats.find(candidate => candidate.seat === seat)?.persona;
  if (!roleFacts) throw new Error('MISSING_ACTOR_FACTS');
  const schema = room.phase.key === 'wolves'
    ? nightActionSchema(room.state as unknown as Match, seat) as ChoiceSchema
    : room.phase.schema as ChoiceSchema;
  const speech = schema.properties?.text?.type === 'string';
  const options: DecisionOption[] = speech ? [] : choices(schema).map((value, index) => ({ id: `option-${index}`, value }));
  const intent: DecisionInput['intent'] = speech ? 'SPEAK' : 'SELECT';
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
    audit: { seatNo: seat, micNo, role: roleFacts.role, phaseInstance: room.phaseInstance,
      publicEventWatermark: events.length },
    outputSchema: speech
      ? { type: 'object', additionalProperties: false, required: ['speech'], properties: { speech: { type: 'string', minLength: 1, maxLength: 300 } } }
      : { type: 'object', additionalProperties: false, required: ['selected'], properties: { selected: { enum: options.map(option => option.id) } } },
    context: {
      rules: {
        instructions: definition.instructions, version: definition.version,
        fact_boundaries: 'game_state和public_history是平民可见的公开事实；self和private_information是本人身份额外知道的事实。私密狼刀口是攻击目标，不代表实际死亡；以公开夜死公告和存活状态判断结算。玩家仍可策略性谎报自己的说法。',
      },
      game_state: { ...publicState, seats: envelope.seats, phase: { key: scene, round: room.phase.round }, last_announced_night: lastAnnouncedNight },
      self: { ...envelope.self, role: roleFacts.role, ...(persona ? { persona } : {}) },
      private_information: { ...roleFacts, events: ownEvents.map(({ type, data }, index) => ({ sequence: index + 1, type, data })) },
      public_history: events.map(({ type, data }, index) => ({ sequence: index + 1, type, data })),
      current_action: currentAction,
    },
  };
}
