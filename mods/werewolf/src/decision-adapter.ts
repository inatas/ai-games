import type { Json } from '@game-ai/core';
import type { DecisionAdapter, DecisionInput, DecisionOutput } from '@game-ai/turn-based';
import { maxSpeechChars } from './speech-policy.ts';

/** Local scripted controller, using the same game task and proposal envelope as a model. */
export class ScriptDecisionAdapter implements DecisionAdapter {
  constructor(private config: { speech: string; seed: number; strategy?: 'fixed' | 'random' }) {
    if (!config.speech.trim() || [...config.speech].length > maxSpeechChars) throw new Error('INVALID_SCRIPT_SPEECH');
  }

  async decide(input: DecisionInput, signal: AbortSignal): Promise<DecisionOutput> {
    if (signal.aborted) return { kind: 'no-valid-input', reason: 'ABORTED' };
    if (input.intent === 'SPEAK') return { kind: 'proposal', value: { speech: this.config.speech } };
    if (!input.options.length) return { kind: 'no-valid-input', reason: 'NO_OPTIONS' };
    let index = 0;
    if (this.config.strategy !== 'fixed') {
      let hash = this.config.seed >>> 0;
      for (const code of `${input.actor.roomId}:${input.actor.phaseInstance}:${input.actor.seat}:${input.scene}`) {
        hash = (Math.imul(hash, 33) ^ code.charCodeAt(0)) >>> 0;
      }
      index = hash % input.options.length;
    }
    return { kind: 'proposal', value: { selected: input.options[index].id } };
  }
}

/** Model and script proposals must pass this same allowlisted decoder before game validation. */
export function decodeWerewolfDecision(input: DecisionInput, output: DecisionOutput): Json | null {
  if (output.kind !== 'proposal') return null;
  if (input.intent === 'SPEAK') {
    if (!('speech' in output.value) || typeof output.value.speech !== 'string' ||
        !output.value.speech.trim() || [...output.value.speech].length > maxSpeechChars) return null;
    return { kind: input.scene === 'last-words' ? 'last-words' : 'speak', text: output.value.speech };
  }
  if (!('selected' in output.value) || typeof output.value.selected !== 'string') return null;
  const selected = output.value.selected;
  return input.options.find(option => option.id === selected)?.value ?? null;
}
