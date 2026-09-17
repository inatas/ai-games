import { projectMap as projectTopology, type MapDefinition } from '@game-ai/game-systems';
import { content, mapRules } from './content.ts';
export const map = content.map;
export function projectMap(value: MapDefinition, current: string, discovered: Set<string>, master: boolean) {
  return { ...projectTopology(value, current, discovered, exit => mapRules.denial(exit, { master }) ? '拜入师门后可进入' : null), regionId: 'qingxi', name: '青溪镇与近郊' };
}
