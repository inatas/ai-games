import type { Json } from '@game-ai/core';

export interface DecisionOption {
  id: string;
  value: Json;
}

export interface DecisionInput {
  intent: 'SPEECH' | 'SELECT';
  scene: string;
  actor: { roomId: string; seat: number; phaseInstance: number };
  /** Server-side audit metadata; never included in the model's six-part context. */
  audit?: { seatNo: number; micNo: number | null; role: string | null;
    phaseInstance: number; publicEventWatermark: number };
  context: {
    rules: Json;
    game_state: Json;
    self: { seat: number; name: string; role: string | null; persona?: string };
    private_information: Json;
    public_history: Json;
    current_action: { request_type: 'SPEECH' | 'SELECT'; scene: string; options: Json[]; phaseInstance: number;
      deadlineAt?: number; publicEventWatermark?: number };
  };
  options: DecisionOption[];
  outputSchema: object;
  /** Trusted MOD projection; all seats on the same board receive identical shared entries. */
  sharedKnowledge?: { id: string; content: string }[];
  /** Only the acting seat's actual role guide. */
  privateKnowledge?: { id: string; content: string };
  /** Rules matched for this seat and action, after the private guide. */
  matchedGuidance?: string[];
}

export type DecisionOutput =
  | { kind: 'proposal'; value: { speech: string } | { selected: string } }
  | { kind: 'no-valid-input'; reason: string };

/** The game judge validates and commits the decoded proposal, regardless of controller. */
export interface DecisionAdapter {
  decide(input: DecisionInput, signal: AbortSignal): Promise<DecisionOutput>;
}
