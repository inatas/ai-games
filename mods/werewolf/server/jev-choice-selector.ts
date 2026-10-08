import { createHash } from 'node:crypto';

export const jevChoiceSelectorVersion = 'confidence-mix-v1';

type Selection = {
  normalizedProbabilities: Record<string, number>;
  samplingProbabilities: Record<string, number>;
  sampledSelected: string;
};

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** The request ID fixes one pseudorandom draw so recovery and review cannot reroll it. */
export function jevDraw(requestId: string): number {
  const bytes = createHash('sha256').update(jevChoiceSelectorVersion).update(':').update(requestId).digest();
  return bytes.readUIntBE(0, 6) / 2 ** 48;
}

/** Treat confidence as this MOD's blend with a uniform prior, then sample once. */
export function sampleJevChoice(ids: string[], answer: unknown, draw: number): Selection | null {
  if (!ids.length || new Set(ids).size !== ids.length || !Number.isFinite(draw) || draw < 0 || draw >= 1 ||
      !object(answer) || typeof answer.choice !== 'string' || !ids.includes(answer.choice) ||
      typeof answer.confidence !== 'number' || !Number.isFinite(answer.confidence) ||
      answer.confidence < 0 || answer.confidence > 1 || !object(answer.probabilities)) return null;
  const probabilities = answer.probabilities;
  if (Object.keys(probabilities).length !== ids.length) return null;
  const weights: number[] = [];
  for (const id of ids) {
    const value = probabilities[id];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) return null;
    weights.push(value);
  }
  const total = weights.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(total) || total <= 0) return null;
  const normalizedProbabilities: Record<string, number> = {};
  const samplingProbabilities: Record<string, number> = {};
  let cumulative = 0;
  let sampledSelected = ids.at(-1)!;
  let selected = false;
  for (let index = 0; index < ids.length; index++) {
    const id = ids[index]!;
    const normalized = weights[index]! / total;
    const sampling = answer.confidence * normalized + (1 - answer.confidence) / ids.length;
    normalizedProbabilities[id] = normalized;
    samplingProbabilities[id] = sampling;
    cumulative += sampling;
    if (!selected && draw < cumulative) { sampledSelected = id; selected = true; }
  }
  return { normalizedProbabilities, samplingProbabilities, sampledSelected };
}
