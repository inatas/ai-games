import type { RobotPublicUser } from '@game-ai/core';
export type RobotCatalogEntry = RobotPublicUser & { available: boolean; controller?: 'script' | 'model'; unavailableReason?: string };
export function fillRobotSeats(seats: (string | null)[], users: RobotCatalogEntry[], random = Math.random): (string | null)[] {
  const available = users.filter(user => user.available).map(user => user.userId).filter(id => !seats.includes(id));
  for (let i=available.length-1;i>0;i--) { const j=Math.floor(random()*(i+1)); [available[i],available[j]]=[available[j],available[i]]; }
  return seats.map(id => id ?? available.pop() ?? null);
}
