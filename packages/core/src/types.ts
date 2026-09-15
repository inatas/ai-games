export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Visibility = 'public' | 'internal';
export interface Transaction { query(text: string, values?: any[]): Promise<{ rows: any[]; rowCount: number | null }> }
/** PostgreSQL-aware persistence port; concrete drivers stay outside core. */
export interface HarnessStore {
  pool: Transaction;
  transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>;
  applyMemory(tx: Transaction, scopeId: string, changes: MemoryChange[]): Promise<void>;
  contextMemory(scopeId: string, visibility: Visibility[], required: string[], subjects: string[], tags: string[]): Promise<{ required: MemoryRecord[]; optional: MemoryRecord[] }>;
  worldview?(scopeId: string): Promise<Worldview | undefined>;
}
export interface Worldview { worldId: string; version: string; content: string; digest: string }
export interface MemoryRecord {
  id: string; kind: 'fact' | 'event' | 'summary' | 'item'; payload: Json;
  sourceIds: string[]; visibility: Visibility; importance: number; sequence: number;
  key?: string; sourceVersion?: string; status?: 'open' | 'closed';
}
export type MemoryChange =
  | { op: 'replace_fact'; key: string; payload: Json; sourceVersion: string; visibility?: Visibility }
  | { op: 'append_event' | 'append_summary' | 'open_item'; id: string; payload: Json; sourceIds?: string[]; subjectIds?: string[]; tags?: string[]; importance?: number; visibility?: Visibility; sourceVersion?: string }
  | { op: 'close_item'; id: string };
export interface Prepared {
  gameVersion: string; facts: Json; instructions: string;
  subjectIds: string[]; tags: string[]; requiredMemoryIds: string[];
  visibility?: Visibility[];
}
export interface ExecutionContext { scopeId: string; input: Json; gameVersion: string }
export interface Binding {
  id: string; version: string; mode: 'assessment' | 'recordMemory';
  inputSchema: object; outputSchema?: object;
  prepare(input: Json, scopeId: string): Promise<Prepared>;
  validate(proposal: Json, facts: Json): { ok: true } | { ok: false; code: string };
  apply(tx: Transaction, proposal: Json, context: ExecutionContext): Promise<{ result: Json; memoryChanges: MemoryChange[] }>;
}
export interface AssessmentInput {
  scopeId: string; requestId: string; expectedMemoryVersion: number;
  bindingId: string; bindingVersion: string; input: Json;
}
export interface Message { role: 'system' | 'user'; content: string }
export interface ModelRequest { requestId: string; attempt: number; messages: Message[]; outputSchema: object; maxOutputTokens: number }
export interface ModelResponse { rawText: string; model: string; usage: { inputTokens: number; outputTokens: number } | null }
export interface ModelAdapter { generate(request: ModelRequest, signal: AbortSignal): Promise<ModelResponse> }
export interface Clock { now(): number }
export interface RequestView {
  requestId: string; status: 'processing' | 'committed' | 'rejected' | 'failed';
  result: Json | null; error: { code: string; detail?: string } | null; memoryVersion: number | null;
}
export class HarnessError extends Error {
  constructor(public code: string, public httpStatus = 400, public detail?: string) { super(code); }
}

