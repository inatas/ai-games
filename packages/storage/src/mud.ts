import type { Transaction } from '@game-ai/core';
import { migratePlatform } from '@game-ai/platform';
import { migrateGameSystems } from '@game-ai/game-systems';

/** Historical aggregate; mapless hosts may install platform alone. */
export async function migrateMud(tx: Transaction) {
  await migratePlatform(tx);
  await migrateGameSystems(tx);
}
