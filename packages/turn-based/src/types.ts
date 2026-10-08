import type { Binding, Json } from '@game-ai/core';
import type { DecisionInput, DecisionOutput } from './decision.ts';
import type { DecisionRuleSet, RuleEvaluation } from './decision-rules.ts';

export interface Seat {
  seat: number;
  name: string;
  modelProfile: string;
  userId?: string;
  controllerKind?: 'robot' | 'human';
  persona?: string;
  scopeId: string;
  interruptScopeId: string;
}
export interface Phase {
  key: string;
  label: string;
  round: number;
  mode: 'sequential' | 'sealed';
  actors: number[];
  schema: object;
  windowGroup?: string;
  interrupt?: { key: string; actors: number[]; schema: object };
}
export interface GameEvent {
  type: string;
  audience: 'public' | 'after-game' | number[];
  data: Json;
}
export interface RecordedEvent extends GameEvent {
  sequence: number;
  phaseInstance: number;
}
export type DecisionOrigin = 'model' | 'script' | 'rule' | 'default' | 'external';
export interface Decision { seat: number; value: Json; origin: DecisionOrigin }
export type Transition = { state: Json; events?: GameEvent[] } & (
  | { phase: Phase; result?: never }
  | { result: Json; phase?: never }
);
/** Trusted, synchronous game code. Callbacks must not perform IO or mutate their inputs. */
export interface RoomDefinition {
  id: string;
  version: string;
  seats: number;
  instructions: string;
  initialize(seats: readonly Seat[]): { state: Json; phase: Phase; events?: GameEvent[] };
  project(state: Json, viewer: number | null): Json;
  validate(state: Json, phase: Phase, seat: number, decision: Json): boolean;
  onDecision?(state: Json, phase: Phase, seat: number, decision: Json): GameEvent[];
  resolve(state: Json, phase: Phase, decisions: readonly Decision[]): Transition;
  decisionSpec?(room: Room, seat: number): DecisionInput;
  decodeDecision?(input: DecisionInput, output: DecisionOutput): Json | null;
  privateMemoryUpdate?: Binding['privateMemoryUpdate'];
  decisionRules?: DecisionRuleSet;
  windowMs?(room: Room): number;
  actionWindowMs?(room: Room): number;
  fixedWindow?(room: Room): boolean;
  completionDelayMs?(room: Room): number | null;
  fallbackDecision?(room: Room, seat: number, reason?: string): Json;
  fallbackOnFailure?(room: Room): boolean;
  minDecisionTimeMs?(room: Room): number;
  revealEvent?(event: RecordedEvent): boolean;
  validateInterrupt?(state: Json, phase: Phase, seat: number, value: Json): boolean;
  resolveInterrupt?(state: Json, phase: Phase, seat: number, value: Json): { pass: true } | Transition;
  reveal?(state: Json): Json;
}
export interface RoomLimits { maxPhases: number; maxRequests: number }
export type Lane = 'normal' | `normal:${number}` | `interrupt:${number}`;
export interface PendingDecision {
  lane: Lane;
  decisionEpoch: number;
  requestId: string;
  scopeId: string;
  seat: number;
  modelProfile: string;
  memoryVersion: number;
  phaseInstance: number;
  facts: Json;
  decisionInput?: DecisionInput;
  failedReason?: string;
}
/** Server-only persistence representation; never serialize this to a client. */
export interface Room {
  id: string;
  runKey: string;
  admissionSignature?: string;
  definitionId: string;
  definitionVersion: string;
  capacity: number;
  status: 'waiting' | 'running' | 'blocked' | 'finished' | 'aborted';
  revision: number;
  seats: Seat[];
  state: Json;
  phase: Phase | null;
  phaseInstance: number;
  decisions: Decision[];
  phaseHistory?: { instance: number; key: string; round: number }[];
  events: RecordedEvent[];
  result: Json;
  limits: RoomLimits;
  requests: number;
  decisionEpoch: number;
  phaseStartedAt?: number;
  phaseDeadlineAt?: number;
  phaseActionDeadlineAt?: number;
  phaseEarlyFinishAt?: number;
  windowGroup?: { key: string; startedAt: number; deadlineAt: number; durationMs: number };
  pendingJobs: Partial<Record<Lane, PendingDecision>>;
  ruleSet?: { id: string; version: number; digest?: string };
  ruleDecisions?: Array<{ phaseInstance: number; seat: number; evaluation: RuleEvaluation; forced: boolean }>;
  error: string | null;
}
export interface VisibleEvent { sequence: number; phaseInstance: number; type: string; data: Json }
export interface SpectatorView {
  id: string;
  revision: number;
  status: Room['status'];
  capacity: number;
  seats: { seat: number; name: string }[];
  phase: { label: string; round: number } | null;
  state: Json;
  events: VisibleEvent[];
  result: Json;
  replay?: Json;
}
