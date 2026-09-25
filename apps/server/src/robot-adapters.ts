import type { ModelAdapter, RobotUser } from '@game-ai/core';
import { ChatCompletionsAdapter } from '@game-ai/model';
import type { DecisionAdapter } from '@game-ai/turn-based';
import { ScriptDecisionAdapter } from '../../../mods/werewolf/src/decision-adapter.ts';
import type { ModelProfile } from './robot-users.ts';

export function profileForRobot(user: RobotUser): string {
  return user.control.kind === 'model' ? user.control.modelProfile : `script:${user.userId}`;
}

/** Build only server-side adapters. Missing model configuration fails before seating. */
export function buildRobotAdapters(
  users: readonly RobotUser[], profiles: readonly ModelProfile[], env: Record<string, string | undefined> = process.env,
  wrapModel: (adapter: ModelAdapter) => ModelAdapter = adapter => adapter,
): Record<string, ModelAdapter | DecisionAdapter> {
  const adapters: Record<string, ModelAdapter | DecisionAdapter> = {};
  for (const profile of profiles) {
    const { environment: names } = profile;
    const baseUrl = env[names.baseUrl];
    const model = env[names.model];
    const apiKey = env[names.apiKey];
    const protocol = env[names.protocol] ?? profile.defaultProtocol;
    if (!baseUrl || !model || !apiKey) {
      if (users.some(user => user.control.kind === 'model' && user.control.modelProfile === profile.id)) throw new Error('MODEL_ENV_MISSING');
      continue;
    }
    if (protocol !== 'json-schema' && protocol !== 'deepseek') throw new Error('MODEL_PROTOCOL_INVALID');
    adapters[profile.id] = wrapModel(new ChatCompletionsAdapter({ baseUrl, model, apiKey, protocol }));
  }
  for (const user of users) {
    const id = profileForRobot(user);
    if (adapters[id]) continue;
    if (user.control.kind === 'script') {
      adapters[id] = new ScriptDecisionAdapter({
        speech: user.control.speech, strategy: user.control.strategy, seed: 0,
      });
      continue;
    }
    throw new Error('UNKNOWN_MODEL_PROFILE');
  }
  // Pre-v5 rooms persisted script:<userId> for the twelve users now controlled by a model.
  // Keep their previous deterministic controller available only for those stored seats.
  for (const user of users) {
    if (user.control.kind !== 'model') continue;
    adapters[`script:${user.userId}`] = new ScriptDecisionAdapter({
      speech: '我是狼人杀玩家', strategy: 'random', seed: 0,
    });
  }
  return adapters;
}
