import type { Json } from '@game-ai/core';

export interface Seat {
  seat: number;
  name: string;
  modelProfile: string;
  scopeId: string;
}
export interface Phase {
  key: string;
  label: string;
  round: number;
  mode: 'sequential' | 'sealed';
  actors: number[];
  schema: object;
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
export interface Decision { seat: number; value: Json }
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
  reveal?(state: Json): Json;
}
export interface RoomLimits { maxPhases: number; maxRequests: number }
export interface PendingDecision {
  requestId: string;
  scopeId: string;
  seat: number;
  modelProfile: string;
  memoryVersion: number;
  phaseInstance: number;
  facts: Json;
}
/** Server-only persistence representation; never serialize this to a client. */
export interface Room {
  id: string;
  runKey: string;
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
  events: RecordedEvent[];
  result: Json;
  limits: RoomLimits;
  requests: number;
  pending: PendingDecision | null;
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
