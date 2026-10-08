import { HarnessError } from '@game-ai/core';
import type { Room, RoomDefinition } from './types.ts';

/** Initialize a trusted transition's clock; adjacent steps can share one durable cutoff. */
export function startPhaseWindow(room: Room, definition: RoomDefinition, now: number, previousInstance: number): void {
  if (room.status !== 'running' || room.phaseInstance === previousInstance || !definition.windowMs) return;
  const duration = definition.windowMs(room);
  const actionDuration = definition.actionWindowMs?.(room) ?? duration;
  if (!Number.isSafeInteger(duration) || duration < 1 || !Number.isSafeInteger(actionDuration) ||
      actionDuration < 1 || actionDuration > duration) throw new HarnessError('INVALID_WINDOW');
  const key = room.phase?.windowGroup;
  if (key) {
    if (room.windowGroup?.key === key) {
      if (room.windowGroup.durationMs !== duration) throw new HarnessError('WINDOW_GROUP_CONFLICT');
    } else room.windowGroup = { key, startedAt: now, deadlineAt: now + duration, durationMs: duration };
  } else delete room.windowGroup;
  room.phaseStartedAt = now;
  room.phaseDeadlineAt = room.windowGroup?.deadlineAt ?? now + duration;
  room.phaseActionDeadlineAt = Math.min(now + actionDuration, room.phaseDeadlineAt);
  delete room.phaseEarlyFinishAt;
}
