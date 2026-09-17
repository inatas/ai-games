import { canonical, HarnessError, type Binding, type HarnessStore, type Json, type Transaction } from '@game-ai/core';
import { lockActor, type ActorState } from './actions.ts';

export interface ActionChoice { actionId: string; params: Record<string, Json> }
const causalProperties = { causationId: { type: 'string', pattern: '^[0-9a-fA-F-]{36}$' }, chainDepth: { type: 'integer', minimum: 0, maximum: 4 } };

/** Trusted choices constrain both the action and its parameters; the later Action still revalidates state. */
export function decisionBinding(store: HarnessStore, options: {
  id: string; choices: ActionChoice[];
  facts(tx: Transaction, actor: ActorState): Promise<Json>;
}): Binding {
  if (!options.choices.length || options.choices.length > 32) throw Error('INVALID_CHOICES');
  const allowed = [...options.choices, null];
  return {
    id: options.id, version: '1', mode: 'assessment',
    inputSchema: { type: 'object', additionalProperties: false, properties: { ...causalProperties, note: { type: 'string', maxLength: 200 } } },
    outputSchema: { anyOf: allowed.map(choice => ({ const: choice })) },
    lockResources: (tx, scopeId) => lockActor(tx, scopeId, 'decide'),
    async prepare(_input, scopeId) {
      return store.transaction(async tx => {
        const actor = await lockActor(tx, scopeId, 'decide');
        return { gameVersion: actor.version, facts: { observed: await options.facts(tx, actor), choices: options.choices as unknown as Json },
          instructions: 'Choose exactly one listed action and its listed parameters, or null to do nothing. Return JSON only. A later action will enforce all rules.', subjectIds: [], tags: [], requiredMemoryIds: [] };
      });
    },
    validate: proposal => allowed.some(choice => canonical(choice) === canonical(proposal)) ? { ok: true } : { ok: false, code: 'INVALID_CHOICE' },
    async apply(tx, proposal, context) {
      const actor = await lockActor(tx, context.scopeId, 'decide');
      if (actor.version !== context.gameVersion) throw new HarnessError('STATE_CONFLICT');
      return { result: { decisionOnly: true, nextAction: proposal }, memoryChanges: [] };
    },
  };
}

/** Display-only output: never becomes a world event or authoritative memory. */
export function narrationBinding(store: HarnessStore, options: { id: string }): Binding {
  return {
    id: options.id, version: '1', mode: 'assessment',
    inputSchema: { type: 'object', additionalProperties: false, required: ['sourceRequestId'], properties: { sourceRequestId: { type: 'string', pattern: '^[0-9a-fA-F-]{36}$' } } },
    outputSchema: { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string', minLength: 1, maxLength: 1000 } } },
    lockResources: (tx, scopeId) => lockActor(tx, scopeId, 'narrate'),
    async prepare(input, scopeId) {
      return store.transaction(async tx => {
        const actor = await lockActor(tx, scopeId, 'narrate');
        const source = (await tx.query("SELECT result FROM fw_requests WHERE scope_id=$1 AND request_id=$2 AND status='committed'", [scopeId, (input as { sourceRequestId: string }).sourceRequestId])).rows[0];
        if (!source) throw new HarnessError('NOT_FOUND', 404);
        if (source.result?.decisionOnly || source.result?.displayOnly) throw new HarnessError('RULE_REJECTED', 409, 'INVALID_NARRATION_SOURCE');
        return { gameVersion: actor.version, facts: source.result, instructions: 'Describe only this committed outcome. Do not invent rewards, actions or state changes. Your text is non-authoritative display content.', subjectIds: [], tags: [], requiredMemoryIds: [] };
      });
    },
    validate: () => ({ ok: true }),
    async apply(tx, proposal, context) {
      const actor = await lockActor(tx, context.scopeId, 'narrate');
      if (actor.version !== context.gameVersion) throw new HarnessError('STATE_CONFLICT');
      return { result: { displayOnly: true, sourceRequestId: (context.input as { sourceRequestId: string }).sourceRequestId, text: (proposal as { text: string }).text }, memoryChanges: [] };
    },
  };
}
