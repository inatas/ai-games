import { HarnessError, type ModelAdapter, type ModelRequest, type ModelResponse } from '@game-ai/core';

export interface ModelPrices { inputCnyPerMillion: number; outputCnyPerMillion: number }

/** Reserves a conservative upper bound before each attempt; failures keep the reservation. */
export class BudgetedModelAdapter implements ModelAdapter {
  constructor(
    private inner: ModelAdapter,
    private prices: ModelPrices,
    private reserveMicroCny: (amount: number) => Promise<void>,
  ) {
    if (!Number.isFinite(prices.inputCnyPerMillion) || prices.inputCnyPerMillion <= 0 ||
        !Number.isFinite(prices.outputCnyPerMillion) || prices.outputCnyPerMillion <= 0) {
      throw new HarnessError('MODEL_PRICE_INVALID');
    }
  }

  async generate(request: ModelRequest, signal: AbortSignal): Promise<ModelResponse> {
    if (!Number.isSafeInteger(request.maxOutputTokens) || request.maxOutputTokens < 1) throw new HarnessError('MODEL_OUTPUT_BUDGET_INVALID');
    // UTF-8 bytes plus protocol overhead conservatively bound the tokenized input.
    const inputBound = Buffer.byteLength(JSON.stringify(request.messages), 'utf8') + 4096;
    const microCny = Math.ceil(inputBound * this.prices.inputCnyPerMillion +
      request.maxOutputTokens * this.prices.outputCnyPerMillion);
    if (!Number.isSafeInteger(microCny) || microCny < 1) throw new HarnessError('MODEL_PRICE_INVALID');
    await this.reserveMicroCny(microCny);
    return this.inner.generate(request, signal);
  }
}
