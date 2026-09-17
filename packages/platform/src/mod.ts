import { Ajv } from 'ajv';

export interface ModDefinition {
  id: string; version: string; contractVersion: number; contentVersion: string; worldviewVersion: string;
  configSchema: object; config: unknown; actions: string[];
}
export class ModRegistry<T extends ModDefinition = ModDefinition> {
  private definitions = new Map<string, T>();
  register(definition: T) {
    const key = `${definition.id}@${definition.version}`;
    if (definition.contractVersion !== 1 || !definition.id || !definition.version || !definition.contentVersion ||
        !definition.worldviewVersion || this.definitions.has(key)) throw new Error(`Invalid MOD identity: ${key}`);
    if (!new Ajv({ strict: true }).validate(definition.configSchema, definition.config)) throw new Error(`Invalid MOD configuration: ${key}`);
    if (!definition.actions.length || definition.actions.some(a=>!a) || new Set(definition.actions).size!==definition.actions.length) throw new Error('Invalid actions');
    this.definitions.set(key, structuredClone(definition));
  }
  get(id: string, version: string): T {
    const definition = this.definitions.get(`${id}@${version}`);
    if (!definition) throw new Error(`Unsupported MOD: ${id}@${version}`);
    return structuredClone(definition);
  }
}
