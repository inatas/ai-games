import { HarnessError } from '@game-ai/core';
import type { PostgresStore } from '@game-ai/storage';

/** Shared, durable trial ceiling across rooms, worker processes, and restarts. */
export class ModelBudgetLedger {
  constructor(private store: PostgresStore, private limitMicroCny = 10_000_000) {}

  async migrate(): Promise<void> {
    await this.store.pool.query(`CREATE TABLE IF NOT EXISTS ww_model_budget (
      id text PRIMARY KEY, spent_micro_cny bigint NOT NULL CHECK (spent_micro_cny >= 0)
    )`);
  }

  async reserve(amount: number): Promise<void> {
    if (!Number.isSafeInteger(amount) || amount < 1) throw new HarnessError('MODEL_PRICE_INVALID');
    await this.store.transaction(async tx => {
      await tx.query("INSERT INTO ww_model_budget(id,spent_micro_cny) VALUES('trial-v1',0) ON CONFLICT(id) DO NOTHING");
      const row = (await tx.query("SELECT spent_micro_cny FROM ww_model_budget WHERE id='trial-v1' FOR UPDATE")).rows[0];
      if (Number(row.spent_micro_cny) + amount > this.limitMicroCny) throw new HarnessError('MODEL_BUDGET_EXCEEDED');
      await tx.query("UPDATE ww_model_budget SET spent_micro_cny=spent_micro_cny+$1 WHERE id='trial-v1'", [amount]);
    });
  }
}
