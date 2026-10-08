import { acceptDecision, eligibleActors, settleDecisionWindow, type Room, type RoomDefinition } from '@game-ai/turn-based';

/** Advance the new preparation cutoff when testing existing skill/day behavior. */
export function endPreparation(source: Room, definition: RoomDefinition): Room {
  let room = source;
  while (room.phase?.key.startsWith('wolf-team-')) {
    const actor = eligibleActors(room)[0];
    room = acceptDecision(room, room.phaseInstance, actor,
      definition.fallbackDecision!(room, actor, 'GAME_DEADLINE'), definition, 'default');
    if (!eligibleActors(room).length) room = settleDecisionWindow(room, definition);
  }
  return room;
}
