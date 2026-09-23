import { Ajv } from 'ajv';
import { HarnessError, canonical, type Json } from '@game-ai/core';
import type { GameEvent, Phase, Room, RoomDefinition, RoomLimits, Seat, SpectatorView, VisibleEvent, Transition } from './types.ts';
import { assertDecisionRuleSet } from './decision-rules.ts';

const ajv = new Ajv({ strict: true, allErrors: true, coerceTypes: false, removeAdditional: false });
const fail = (code: string): never => { throw new HarnessError(code, 409); };
const positive = (n: number) => Number.isSafeInteger(n) && n > 0;
const text = (s: string) => typeof s === 'string' && s.trim().length > 0 && s.length <= 200;

export function assertDefinition(def: RoomDefinition): void {
  if (!text(def.id) || !text(def.version) || !positive(def.seats) || def.seats > 100 ||
      typeof def.instructions !== 'string' ||
      !['initialize', 'project', 'validate', 'resolve'].every(key => typeof def[key as keyof RoomDefinition] === 'function')) {
    fail('INVALID_DEFINITION');
  }
  if (def.decisionRules) {
    if (!def.decisionSpec || !def.decodeDecision) fail('INVALID_DEFINITION');
    assertDecisionRuleSet(def.decisionRules);
  }
}
export function assertVersion(room: Room, def: RoomDefinition): void {
  if (room.definitionId !== def.id || room.definitionVersion !== def.version || room.capacity !== def.seats) fail('DEFINITION_MISMATCH');
  const expected = def.decisionRules ? { id: def.decisionRules.id, version: def.decisionRules.version } : undefined;
  if (canonical(room.ruleSet ?? null) !== canonical(expected ?? null)) fail('RULE_SET_MISMATCH');
}
export function assertPhase(room: Room, phase: Phase): void {
  if (!phase || !text(phase.key) || !text(phase.label) || !positive(phase.round) ||
      !['sequential', 'sealed'].includes(phase.mode) || !Array.isArray(phase.actors) || !phase.actors.length ||
      new Set(phase.actors).size !== phase.actors.length ||
      phase.actors.some(seat => !room.seats.some(s => s.seat === seat)) ||
      !phase.schema || typeof phase.schema !== 'object') fail('INVALID_PHASE');
  if (phase.interrupt && (!text(phase.interrupt.key) || !Array.isArray(phase.interrupt.actors) ||
      !phase.interrupt.actors.length || new Set(phase.interrupt.actors).size !== phase.interrupt.actors.length ||
      phase.interrupt.actors.some(actor => !room.seats.some(s => s.seat === actor)))) fail('INVALID_PHASE');
  try { ajv.compile(phase.schema); if (phase.interrupt) ajv.compile(phase.interrupt.schema); } catch { fail('INVALID_PHASE_SCHEMA'); }
}

export function createRoom(id: string, runKey: string, def: RoomDefinition, limits: Partial<RoomLimits> = {}): Room {
  assertDefinition(def);
  if (!text(id) || !text(runKey)) fail('INVALID_ROOM');
  const actual = { maxPhases: limits.maxPhases ?? 200, maxRequests: limits.maxRequests ?? 2000 };
  if (!positive(actual.maxPhases) || !positive(actual.maxRequests)) fail('INVALID_LIMITS');
  return {
    id, runKey, definitionId: def.id, definitionVersion: def.version, capacity: def.seats,
    status: 'waiting', revision: 0, seats: [], state: null, phase: null, phaseInstance: 0,
    decisions: [], events: [], result: null, limits: actual, requests: 0, decisionEpoch: 0, pendingJobs: {}, error: null,
    ...(def.decisionRules ? { ruleSet: { id: def.decisionRules.id, version: def.decisionRules.version }, ruleDecisions: [] } : {}),
  };
}

function appendEvents(room: Room, events: GameEvent[]): void {
  if (!Array.isArray(events)) fail('INVALID_EVENT');
  for (const event of events) {
    if (!event || !text(event.type) || event.data === undefined ||
        !(event.audience === 'public' || event.audience === 'after-game' ||
          (Array.isArray(event.audience) && event.audience.length > 0 &&
           event.audience.every(seat => room.seats.some(s => s.seat === seat))))) fail('INVALID_EVENT');
    room.events.push({ ...structuredClone(event), sequence: room.events.length + 1, phaseInstance: room.phaseInstance });
  }
}

export function occupySeat(source: Room, seat: Seat, def: RoomDefinition): Room {
  assertVersion(source, def);
  if (!seat || !positive(seat.seat) || seat.seat > source.capacity ||
      !text(seat.name) || !text(seat.modelProfile) || !text(seat.scopeId) || !text(seat.interruptScopeId) ||
      (seat.userId !== undefined && !text(seat.userId)) ||
      (seat.controllerKind !== undefined && !['robot', 'human'].includes(seat.controllerKind)) ||
      (seat.persona !== undefined && !text(seat.persona))) fail('INVALID_SEAT');
  const existing = source.seats.find(s => s.seat === seat.seat);
  if (existing) {
    if (canonical(existing) !== canonical(seat)) fail('SEAT_CONFLICT');
    return structuredClone(source);
  }
  if (source.status !== 'waiting') fail('ROOM_ALREADY_STARTED');
  const scopes = source.seats.flatMap(s => [s.scopeId, s.interruptScopeId]);
  if (seat.scopeId === seat.interruptScopeId || scopes.includes(seat.scopeId) || scopes.includes(seat.interruptScopeId)) fail('SCOPE_CONFLICT');
  const room = structuredClone(source);
  room.seats.push(structuredClone(seat));
  room.seats.sort((a, b) => a.seat - b.seat);
  room.revision++;
  if (room.seats.length === room.capacity) {
    const initial = def.initialize(structuredClone(room.seats));
    assertPhase(room, initial.phase);
    room.state = structuredClone(initial.state);
    room.phase = structuredClone(initial.phase);
    room.phaseInstance = 1;
    room.phaseHistory = [{ instance: 1, key: initial.phase.key, round: initial.phase.round }];
    room.status = 'running';
    appendEvents(room, initial.events ?? []);
  }
  return room;
}

export function eligibleActors(room: Room): number[] {
  if (room.status !== 'running' || !room.phase) return [];
  const outstanding = room.phase.actors.filter(seat => !room.decisions.some(d => d.seat === seat));
  return room.phase.mode === 'sequential' ? outstanding.slice(0, 1) : outstanding;
}

export function validateDecision(room: Room, instance: number, seat: number, value: Json, def: RoomDefinition): void {
  assertVersion(room, def);
  if (room.status !== 'running' || !room.phase) fail('ROOM_NOT_RUNNING');
  if (room.phaseInstance !== instance) fail('PHASE_CONFLICT');
  if (!eligibleActors(room).includes(seat)) fail('ACTOR_NOT_ELIGIBLE');
  if (!ajv.compile(room.phase!.schema)(value)) fail('INVALID_DECISION');
  if (def.validate(structuredClone(room.state), structuredClone(room.phase!), seat, structuredClone(value)) !== true) fail('RULE_REJECTED');
}

export function acceptDecision(source: Room, instance: number, seat: number, value: Json, def: RoomDefinition): Room {
  validateDecision(source, instance, seat, value, def);
  const room = structuredClone(source);
  const phase = room.phase!;
  room.decisions.push({ seat, value: structuredClone(value) });
  // The mandatory audit is private to its owner until a normal finish.
  appendEvents(room, [{ type: 'decision', audience: [seat], data: { seat, value } }]);
  if (phase.mode === 'sequential') {
    appendEvents(room, def.onDecision?.(structuredClone(room.state), structuredClone(phase), seat, structuredClone(value)) ?? []);
  }
  room.revision++;
  const complete = room.decisions.length === phase.actors.length;
  const defer = complete && room.phaseDeadlineAt !== undefined && def.fixedWindow?.(room) === true;
  if (!defer && (phase.mode === 'sequential' || complete)) room.decisionEpoch++;
  if (complete && !defer) {
    // Normalize ordering so concurrent arrival cannot change game resolution.
    const decisions = phase.actors.map(actor => room.decisions.find(d => d.seat === actor)!);
    const next = def.resolve(structuredClone(room.state), structuredClone(phase), structuredClone(decisions));
    applyTransition(room, next);
  }
  return room;
}

/** Resolve a complete fixed window at its persisted boundary. The runtime owns the clock check. */
export function settleDecisionWindow(source: Room, def: RoomDefinition): Room {
  assertVersion(source, def);
  if (source.status !== 'running' || !source.phase ||
      source.decisions.length !== source.phase.actors.length ||
      !def.fixedWindow?.(source)) fail('WINDOW_NOT_READY');
  const room = structuredClone(source);
  const decisions = room.phase!.actors.map(actor => room.decisions.find(decision => decision.seat === actor)!);
  const next = def.resolve(structuredClone(room.state), structuredClone(room.phase!), structuredClone(decisions));
  room.decisionEpoch++;
  room.revision++;
  applyTransition(room, next);
  return room;
}

function applyTransition(room: Room, next: Transition): void {
  if (!next || next.state === undefined || (next.phase === undefined) === (next.result === undefined)) fail('INVALID_TRANSITION');
  appendEvents(room, next.events ?? []);
  room.state = structuredClone(next.state);
  room.decisions = [];
  delete room.phaseEarlyFinishAt;
  if (next.phase !== undefined) {
    assertPhase(room, next.phase);
    if (room.phaseInstance >= room.limits.maxPhases) {
      room.status = 'aborted';
      room.error = 'PHASE_BUDGET_EXCEEDED';
    } else {
      room.phase = structuredClone(next.phase);
      room.phaseInstance++;
      room.phaseHistory ??= [];
      room.phaseHistory.push({ instance: room.phaseInstance, key: next.phase.key, round: next.phase.round });
    }
  } else {
    room.status = 'finished';
    room.result = structuredClone(next.result!);
    room.phase = null;
  }
}

export function validateInterrupt(room: Room, instance: number, seat: number, value: Json, def: RoomDefinition): void {
  assertVersion(room, def);
  if (room.status !== 'running' || !room.phase) fail('ROOM_NOT_RUNNING');
  if (room.phaseInstance !== instance) fail('PHASE_CONFLICT');
  if (!room.phase!.interrupt?.actors.includes(seat)) fail('ACTOR_NOT_ELIGIBLE');
  if (!def.validateInterrupt || !def.resolveInterrupt) fail('INVALID_DEFINITION');
  if (!ajv.compile(room.phase!.interrupt!.schema)(value)) fail('INVALID_DECISION');
  if (def.validateInterrupt!(structuredClone(room.state), structuredClone(room.phase!), seat, structuredClone(value)) !== true) fail('RULE_REJECTED');
}

export function acceptInterrupt(source: Room, instance: number, seat: number, value: Json, def: RoomDefinition): Room {
  validateInterrupt(source, instance, seat, value, def);
  const room = structuredClone(source);
  const next = def.resolveInterrupt!(structuredClone(room.state), structuredClone(room.phase!), seat, structuredClone(value));
  if (next && 'pass' in next && next.pass === true) return room;
  appendEvents(room, [{ type: 'interrupt', audience: [seat], data: { seat, value } }]);
  applyTransition(room, next as Transition);
  room.revision++;
  room.decisionEpoch++;
  return room;
}

function visibleEvents(room: Room, viewer: number | null, reveal: boolean): VisibleEvent[] {
  return room.events.filter(event => reveal || event.audience === 'public' ||
    (viewer !== null && Array.isArray(event.audience) && event.audience.includes(viewer)))
    .map(({ sequence, phaseInstance, type, data }) => ({ sequence, phaseInstance, type, data: structuredClone(data) }));
}

/** Server-only actor context; caller must derive viewer from the authorized execution scope. */
export function actorView(room: Room, viewer: number, def: RoomDefinition): Json {
  assertVersion(room, def);
  const seat = room.seats.find(s => s.seat === viewer);
  if (!seat) fail('ACTOR_NOT_ELIGIBLE');
  return {
    self: { seat: viewer, name: seat!.name },
    seats: room.seats.map(s => ({ seat: s.seat, name: s.name })),
    phase: room.phase ? { key: room.phase.key, round: room.phase.round, instance: room.phaseInstance } : null,
    state: room.status === 'waiting' ? null : def.project(structuredClone(room.state), viewer),
    events: visibleEvents(room, viewer, false) as unknown as Json,
  };
}

export function spectatorView(room: Room, def: RoomDefinition): SpectatorView {
  assertVersion(room, def);
  const reveal = room.status === 'finished';
  return {
    id: room.id, revision: room.revision, status: room.status, capacity: room.capacity,
    seats: room.seats.map(s => ({ seat: s.seat, name: s.name })),
    phase: room.phase ? { label: room.phase.label, round: room.phase.round } : null,
    state: room.status === 'waiting' ? null : def.project(structuredClone(room.state), null),
    events: visibleEvents(room, null, reveal), result: reveal ? structuredClone(room.result) : null,
    ...(reveal && def.reveal ? { replay: def.reveal(structuredClone(room.state)) } : {}),
  };
}
