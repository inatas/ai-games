import type { Binding, Transaction } from '@game-ai/core';
import type { WorldView } from './view.ts';

import type { SocialPolicy } from '@game-ai/platform';

export interface ModHost {
  socialPolicy?: SocialPolicy;
  id: string; prefix: string; worldviewPath: string; worldId: string; worldVersion: string;
  actions: readonly string[]; fields: string[];
  migrate(): Promise<void>;
  initialize(tx: Transaction, scopeId: string): Promise<void>;
  bindings(): Binding[];
  snapshot(tx: Transaction, scopeId: string): Promise<WorldView & Record<string, unknown>>;
}
