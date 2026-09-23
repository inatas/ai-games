import type { RobotUser } from '@game-ai/core';
import { createHash } from 'node:crypto';
import { profileForRobot } from './robot-adapters.ts';

interface SeatingRuntime {
  create(runKey: string, limits: object, admissionSignature: string): Promise<{
    id: string; status?: string; seats?: { seat: number; userId?: string }[];
  }>;
  seat(roomId: string, config: {
    seat: number; name: string; userId: string; persona: string; modelProfile: string; controllerKind: 'robot';
  }): Promise<unknown>;
}

/** Trusted host operation; a model user cannot be silently replaced by a script. */
export async function setupRobotRoom(runtime: SeatingRuntime, runKey: string, roster: readonly RobotUser[]): Promise<string> {
  if (roster.length !== 12 || new Set(roster.map(user => user.userId)).size !== 12 ||
      roster.filter(user => user.control.kind === 'model').length !== 1 ||
      roster.some(user => user.kind !== 'robot')) throw new Error('INVALID_ROSTER');
  const signature = createHash('sha256').update(JSON.stringify(roster.map(user => user.userId))).digest('hex');
  const room = await runtime.create(runKey, {}, signature);
  if (room.status && room.status !== 'waiting') return room.id;
  for (const [index, user] of roster.entries()) {
    const existing = room.seats?.find(seat => seat.seat === index + 1);
    if (existing) {
      if (existing.userId !== user.userId) throw new Error('SEAT_CONFLICT');
      continue;
    }
    await runtime.seat(room.id, {
      seat: index + 1, userId: user.userId, name: user.nickname,
      persona: user.persona.description, modelProfile: profileForRobot(user), controllerKind: 'robot',
    });
  }
  return room.id;
}
