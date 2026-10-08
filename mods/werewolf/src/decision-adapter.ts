import type { Json } from '@game-ai/core';
import type { DecisionAdapter, DecisionInput, DecisionOutput } from '@game-ai/turn-based';
import { maxSpeechChars } from './speech-policy.ts';
import { parseTeamProposalFields, parseTeamResponse, type TeamPlan } from './wolf-team.ts';

/** Local scripted controller, using the same game task and proposal envelope as a model. */
export class ScriptDecisionAdapter implements DecisionAdapter {
  constructor(private config: { speech: string; seed: number; strategy?: 'fixed' | 'random' }) {
    if (!config.speech.trim() || [...config.speech].length > maxSpeechChars) throw new Error('INVALID_SCRIPT_SPEECH');
  }

  async decide(input: DecisionInput, signal: AbortSignal): Promise<DecisionOutput> {
    if (signal.aborted) return { kind: 'no-valid-input', reason: 'ABORTED' };
    if (input.intent === 'SPEECH') return { kind: 'proposal', value: { speech: this.config.speech } };
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
  if (input.intent === 'SPEECH') {
    if (!('speech' in output.value) || typeof output.value.speech !== 'string' ||
        !output.value.speech.trim() || [...output.value.speech].length > maxSpeechChars) return null;
    if (input.scene === 'wolf-team-proposal') {
      const task = input.context.current_action as unknown as { team_organization: { participants: number[]; normalOnly: boolean } };
      const game = input.context.game_state as unknown as { players: { seat: number; alive: boolean }[] };
      const proposal = parseTeamProposalFields((output.value as Record<string, unknown>).team_proposal,
        game.players.filter(p => p.alive).map(p => p.seat), task.team_organization.participants,
        task.team_organization.normalOnly, input.actor.seat);
      return { kind: 'team-proposal', text: output.value.speech, proposal: proposal as unknown as Json,
        reason: proposal ? null : 'INVALID_OR_ABSENT_PROPOSAL' };
    }
    return { kind: input.scene === 'last-words' ? 'last-words' : 'speech', text: output.value.speech };
  }
  if (!('selected' in output.value) || typeof output.value.selected !== 'string') return null;
  const selected = output.value.selected;
  const action = input.options.find(option => option.id === selected)?.value ?? null;
  if (action && input.scene === 'wolves' && input.context.self.role === 'wolf') {
    const privateFacts = input.context.private_information as unknown as { team_plan?: TeamPlan | null };
    const response = parseTeamResponse((output.value as Record<string, unknown>).team_response, privateFacts.team_plan ?? null, input.actor.seat);
    if (response) return { ...(action as Record<string, Json>), teamResponse: response as unknown as Json };
  }
  return action;
}
