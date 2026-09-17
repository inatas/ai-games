import { validateWorld, type World } from '@game-ai/game-systems';
import { map } from './map.ts';
import { npcs } from './npcs.ts';

export { validateWorld };
export type { World };
export { projectMap } from './map.ts';

export const world: World = { ...map, npcs };
validateWorld(world);
