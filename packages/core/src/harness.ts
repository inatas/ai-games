import { Ajv, type ValidateFunction } from 'ajv';
import { createHash } from 'node:crypto';
import type { HarnessStore, Transaction } from './types.ts';
import { buildContext, conservativeCounter, type TokenCounter } from './context.ts';
import { HarnessError, type AssessmentInput, type Binding, type Clock, type Json, type ModelAdapter, type ModelRequest, type RequestView } from './types.ts';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const canonical = (value: any): string => {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
};
type Options = {
  clock?: Clock; callTimeoutMs?: number; totalTimeoutMs?: number; leaseMs?: number;
  counter?: TokenCounter; inputBudget?: number; outputBudget?: number; modelWindow?: number;
  hook?: (point: 'claimed' | 'host' | 'memory' | 'committed', input: AssessmentInput) => Promise<void>;
};
export class Harness {
  private bindings = new Map<string, { binding: Binding; input: ValidateFunction; output?: ValidateFunction }>();
  private ajv = new Ajv({ allErrors: true, strict: true, coerceTypes: false, removeAdditional: false });
  private jobs = new Set<Promise<void>>();
  private controllers = new Set<AbortController>();
  private clock: Clock;
  private leaseMs: number;
  constructor(public store: HarnessStore, private model: ModelAdapter, private options: Options = {}) {
    this.clock = options.clock ?? { now: () => Date.now() };
    this.leaseMs = options.leaseMs ?? 90000;
  }
  register(binding: Binding) {
    if (binding.mode === 'assessment' && !binding.outputSchema) throw new Error('Assessment requires outputSchema');
    this.bindings.set(binding.id, { binding, input: this.ajv.compile(binding.inputSchema), output: binding.outputSchema ? this.ajv.compile(binding.outputSchema) : undefined });
    return this;
  }
  private view(row: any): RequestView {
    return { requestId: row.request_id, status: row.status, result: row.result, error: row.error, memoryVersion: row.memory_version };
  }
  async get(scopeId: string, requestId: string, tx: Transaction = this.store.pool): Promise<RequestView> {
    if (!uuid.test(scopeId) || !uuid.test(requestId)) throw new HarnessError('INVALID_INPUT');
    const { rows } = await tx.query('SELECT * FROM fw_requests WHERE scope_id=$1 AND request_id=$2', [scopeId, requestId]);
    if (!rows.length) throw new HarnessError('NOT_FOUND', 404);
    return this.view(rows[0]);
  }
  async submit(input: AssessmentInput, authorize?: (tx: Transaction) => Promise<unknown>): Promise<RequestView> {
    if (!input || !uuid.test(input.scopeId) || !uuid.test(input.requestId) || !Number.isSafeInteger(input.expectedMemoryVersion) || input.expectedMemoryVersion < 0 || typeof input.bindingId !== 'string' || typeof input.bindingVersion !== 'string' || input.input === undefined || Buffer.byteLength(canonical(input)) > 32768) throw new HarnessError('INVALID_INPUT');
    const registered = this.bindings.get(input.bindingId);
    // Hash the declared binding identity; old results remain retrievable after upgrade.
    const hash = createHash('sha256').update(canonical(input)).digest('hex');
    let claimed = false;
    const view = await this.store.transaction(async tx => {
      await authorize?.(tx);
      await registered?.binding.lockResources?.(tx, input.scopeId);
      const scope = await tx.query('SELECT * FROM fw_scopes WHERE id=$1 FOR UPDATE', [input.scopeId]);
      if (!scope.rows.length) throw new HarnessError('NOT_FOUND', 404);
      await tx.query("UPDATE fw_requests SET status='failed',error=$3 WHERE scope_id=$1 AND status='processing' AND lease_expires_at<=$2", [input.scopeId, this.clock.now(), JSON.stringify({ code: 'PROCESSING_EXPIRED' })]);
      const previous = await tx.query('SELECT * FROM fw_requests WHERE scope_id=$1 AND request_id=$2', [input.scopeId, input.requestId]);
      if (previous.rows.length) {
        if (previous.rows[0].hash !== hash) throw new HarnessError('IDEMPOTENCY_CONFLICT', 409);
        return this.view(previous.rows[0]);
      }
      if (!registered || registered.binding.version !== input.bindingVersion) throw new HarnessError('BINDING_MISMATCH', 409);
      if (!registered.input(input.input)) throw new HarnessError('INVALID_INPUT');
      if (scope.rows[0].memory_version !== input.expectedMemoryVersion) throw new HarnessError('VERSION_CONFLICT', 409);
      if ((await tx.query("SELECT 1 FROM fw_requests WHERE scope_id=$1 AND status='processing'", [input.scopeId])).rowCount) throw new HarnessError('SCOPE_BUSY', 409);
      const result = await tx.query(`INSERT INTO fw_requests(scope_id,request_id,hash,binding_id,binding_version,mode,status,lease_expires_at,input)
        VALUES($1,$2,$3,$4,$5,$6,'processing',$7,$8) RETURNING *`, [input.scopeId, input.requestId, hash, input.bindingId, input.bindingVersion, registered.binding.mode, this.clock.now() + this.leaseMs, JSON.stringify(input.input)]);
      claimed = true; return this.view(result.rows[0]);
    });
    if (claimed) {
      const job = this.execute(input, registered!).catch(() => { /* Recovery scan handles storage outages. */ });
      this.jobs.add(job); void job.finally(() => this.jobs.delete(job));
    }
    return view;
  }
  async drain() { await Promise.all([...this.jobs]); }
  async close() { this.controllers.forEach(c => c.abort()); await this.drain(); }
  async recover() {
    // Match commit lock order: scope first, then request.
    const scopes = await this.store.pool.query("SELECT DISTINCT scope_id FROM fw_requests WHERE status='processing' AND lease_expires_at<=$1", [this.clock.now()]);
    for (const row of scopes.rows) await this.store.transaction(async tx => {
      await tx.query('SELECT id FROM fw_scopes WHERE id=$1 FOR UPDATE', [row.scope_id]);
      await tx.query("UPDATE fw_requests SET status='failed',error=$3 WHERE scope_id=$1 AND status='processing' AND lease_expires_at<=$2", [row.scope_id, this.clock.now(), JSON.stringify({ code: 'PROCESSING_EXPIRED' })]);
    });
  }
  private async execute(input: AssessmentInput, registered: { binding: Binding; output?: ValidateFunction }) {
    const binding = registered.binding;
    const controller = new AbortController(); this.controllers.add(controller);
    const deadline = this.clock.now() + (this.options.totalTimeoutMs ?? 75000);
    const totalTimer = setTimeout(() => controller.abort(), this.options.totalTimeoutMs ?? 75000);
    try {
      await this.options.hook?.('claimed', input);
      const prepared = await binding.prepare(input.input, input.scopeId);
      let proposal: Json = null;
      if (binding.mode === 'assessment') {
        const worldview = await this.store.worldview?.(input.scopeId);
        const memories = await this.store.contextMemory(input.scopeId, prepared.visibility ?? ['public'], prepared.requiredMemoryIds, prepared.subjectIds, prepared.tags);
        const context = buildContext({ worldview, facts: prepared.facts, instructions: prepared.instructions, input: input.input, schema: binding.outputSchema!, ...memories,
          counter: this.options.counter, inputBudget: this.options.inputBudget, outputBudget: this.options.outputBudget, window: this.options.modelWindow });
        for (let attempt = 1; attempt <= 2; attempt++) {
          const messages = [...context.messages];
          if (attempt === 2) messages.push({ role: 'system', content: 'Your previous response did not match OUTPUT_SCHEMA. Return only a valid JSON object with exactly the required fields and allowed values.' });
          if ((this.options.counter ?? conservativeCounter)(messages) > context.inputBudget) throw new HarnessError('CONTEXT_TOO_LARGE');
          const request: ModelRequest = { requestId: input.requestId, attempt, messages, outputSchema: binding.outputSchema!, maxOutputTokens: context.outputBudget };
          const started = this.clock.now(); let response; let code: string | null = null;
          try { response = await this.callModel(request, controller.signal); }
          catch (error) { code = error instanceof HarnessError ? error.code : 'MODEL_UNAVAILABLE'; throw error; }
          finally {
            await this.store.pool.query(`INSERT INTO fw_model_calls(scope_id,request_id,attempt,model,usage,latency_ms,context_ids,error_code,world_id,world_version,world_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
              [input.scopeId,input.requestId,attempt,response?.model ?? 'unknown',response?.usage ? JSON.stringify(response.usage) : null, Math.max(0,this.clock.now()-started),context.contextIds,code,worldview?.worldId ?? null,worldview?.version ?? null,worldview?.digest ?? null]);
          }
          let valid = false;
          try { if (Buffer.byteLength(response!.rawText, 'utf8') <= 16384) { proposal = JSON.parse(response!.rawText); valid = !!registered.output!(proposal); } } catch { /* Invalid JSON is repairable. */ }
          if (valid) break;
          if (attempt === 2) throw new HarnessError('MODEL_INVALID_OUTPUT');
        }
      }
      const validation = binding.validate(proposal, prepared.facts);
      if (!validation.ok) throw new HarnessError('RULE_REJECTED', 409, validation.code);
      await this.store.transaction(async tx => {
        await binding.lockResources?.(tx, input.scopeId);
        const scope = (await tx.query('SELECT * FROM fw_scopes WHERE id=$1 FOR UPDATE', [input.scopeId])).rows[0];
        const request = (await tx.query('SELECT * FROM fw_requests WHERE scope_id=$1 AND request_id=$2 FOR UPDATE', [input.scopeId,input.requestId])).rows[0];
        if (request.status !== 'processing' || Number(request.lease_expires_at) <= this.clock.now()) throw new HarnessError('PROCESSING_EXPIRED');
        if (controller.signal.aborted || this.clock.now() >= deadline) throw new HarnessError('MODEL_TIMEOUT');
        if (scope.memory_version !== input.expectedMemoryVersion) throw new HarnessError('STATE_CONFLICT');
        const result = await binding.apply(tx, proposal, { scopeId: input.scopeId, input: input.input, gameVersion: prepared.gameVersion });
        await this.options.hook?.('host', input);
        await this.store.applyMemory(tx, input.scopeId, result.memoryChanges);
        await this.options.hook?.('memory', input);
        if (controller.signal.aborted || this.clock.now() >= deadline || Number(request.lease_expires_at) <= this.clock.now()) throw new HarnessError('PROCESSING_EXPIRED');
        await tx.query('UPDATE fw_scopes SET memory_version=memory_version+1 WHERE id=$1', [input.scopeId]);
        await tx.query("UPDATE fw_requests SET status='committed',proposal=$3,result=$4,memory_version=$5 WHERE scope_id=$1 AND request_id=$2", [input.scopeId,input.requestId,JSON.stringify(proposal),JSON.stringify(result.result),scope.memory_version+1]);
      });
      await this.options.hook?.('committed', input);
    } catch (error) {
      const e = error instanceof HarnessError ? error : new HarnessError('INTERNAL_ERROR');
      const status = ['MODEL_INVALID_OUTPUT','RULE_REJECTED','INVALID_INPUT'].includes(e.code) ? 'rejected' : 'failed';
      await this.store.pool.query("UPDATE fw_requests SET status=$3,error=$4 WHERE scope_id=$1 AND request_id=$2 AND status='processing'", [input.scopeId,input.requestId,status,JSON.stringify({ code: e.code, ...(e.detail ? { detail: e.detail } : {}) })]);
    } finally { clearTimeout(totalTimer); this.controllers.delete(controller); }
  }
  private async callModel(request: ModelRequest, parent: AbortSignal) {
    const child = new AbortController();
    const abort = () => child.abort(); parent.addEventListener('abort', abort, { once: true });
    if (parent.aborted) child.abort();
    const timer = setTimeout(() => child.abort(), this.options.callTimeoutMs ?? 30000);
    let listener: () => void;
    const cancelled = new Promise<never>((_, reject) => {
      listener = () => reject(new HarnessError('MODEL_TIMEOUT'));
      if (child.signal.aborted) listener(); else child.signal.addEventListener('abort', listener, { once: true });
    });
    try { return await Promise.race([this.model.generate(request, child.signal), cancelled]); }
    catch (e) { if (e instanceof HarnessError) throw e; throw new HarnessError('MODEL_UNAVAILABLE'); }
    finally { clearTimeout(timer); parent.removeEventListener('abort', abort); child.signal.removeEventListener('abort', listener!); }
  }
}


