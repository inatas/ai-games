import { fileURLToPath } from 'node:url';
import { loadContent, RuleRegistry } from '@game-ai/game-systems';
export const mapRules = new RuleRegistry().register('qingxi.master', { type: 'object', additionalProperties: false }, facts => facts.master === true ? null : 'EXIT_LOCKED');
export const content = loadContent(fileURLToPath(new URL('../content/', import.meta.url)), mapRules, ['move']);
