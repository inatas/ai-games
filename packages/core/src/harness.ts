import { Ajv, type ValidateFunction } from 'ajv';
import { createHash, randomUUID } from 'node:crypto';
import type { HarnessStore, Transaction } from './types.ts';
import { buildContext, conservativeCounter, type TokenCounter } from './context.ts';
import { HarnessError, type AssessmentInput, type Binding, type Clock, type Json, type ModelAdapter, type ModelRequest, type Prepared, type RequestView } from './types.ts';
import type { NetworkRetryOptions } from './model-network-retry.ts';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const canonical = (value: any): string => {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
};
type Options = {
  clock?: Clock; callTimeoutMs?: number; totalTimeoutMs?: number; leaseMs?: number;
  counter?: TokenCounter; inputBudget?: number; outputBudget?: number; modelWindow?: number;
  networkRetry?: NetworkRetryOptions;
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
    const retry = options.networkRetry;
    if (retry && (retry.maxAttempts !== 3 || retry.delaysMs.length !== 2 ||
        retry.delaysMs.some(value => value < 1) || !retry.key ||
        ![...retry.delaysMs, retry.jitterMs, retry.minRemainingMs, retry.commitReserveMs]
          .every(value => Number.isSafeInteger(value) && value >= 0))) throw new Error('INVALID_NETWORK_RETRY');
  }
  register(binding: Binding) {
    if (binding.mode === 'assessment' && !binding.outputSchema) throw new Error('Assessment requires outputSchema');
    this.bindings.set(binding.id, { binding, input: this.ajv.compile(binding.inputSchema), output: binding.outputSchema ? this.ajv.compile(binding.outputSchema) : undefined });
    return this;
  }
  private view(row: any): RequestView {
    return { requestId: row.request_id, status: row.status, result: row.result, error: row.error, memoryVersion: row.memory_version };
  }
  private async logModelEvent(
    tx: Transaction, input: AssessmentInput, prepared: Prepared,
    eventType: string, result: string, details: Record<string, unknown>,
  ): Promise<void> {
    const context = prepared.eventContext;
    const payload = {
      schemaVersion: 1, scopeId: input.scopeId, bindingId: input.bindingId,
      bindingVersion: input.bindingVersion, simulated: this.model.simulated === true,
      ...(context?.details && typeof context.details === 'object' && !Array.isArray(context.details) ? context.details : {}),
      ...details,
    };
    await tx.query(`INSERT INTO fw_event_log
      (event_id,event_type,occurred_at,user_id,mod_id,room_id,request_id,result,details)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [
      randomUUID(), eventType, new Date(this.clock.now()),
      context?.userId ?? null, context?.modId ?? null, context?.roomId ?? null,
      input.requestId, result, JSON.stringify(payload),
    ]);
  }
  validateInput(bindingId: string, input: Json): boolean {
    return !!this.bindings.get(bindingId)?.input(input);
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
      const expired = (await tx.query("SELECT request_id FROM fw_requests WHERE scope_id=$1 AND status='processing' AND lease_expires_at<=$2",
        [row.scope_id, this.clock.now()])).rows;
      for (const request of expired) {
        const started = (await tx.query(`SELECT * FROM fw_event_log AS start
          WHERE start.request_id=$1 AND start.event_type='model.call.started.v1'
            AND start.details->>'scopeId'=$2
            AND NOT EXISTS (SELECT 1 FROM fw_event_log AS terminal
              WHERE terminal.request_id=start.request_id
                AND terminal.details->>'scopeId'=start.details->>'scopeId'
                AND terminal.details->>'attempt'=start.details->>'attempt'
                AND terminal.event_type IN ('model.call.finished.v1','model.call.failed.v1','model.call.orphaned.v1'))`,
          [request.request_id, row.scope_id])).rows;
        for (const event of started) await tx.query(`INSERT INTO fw_event_log
          (event_id,event_type,occurred_at,user_id,mod_id,room_id,request_id,result,details)
          VALUES($1,'model.call.orphaned.v1',$2,$3,$4,$5,$6,'unknown',$7)`, [
            randomUUID(), new Date(this.clock.now()), event.user_id, event.mod_id, event.room_id,
            event.request_id, JSON.stringify({ schemaVersion: 1, scopeId: row.scope_id,
              attempt: event.details.attempt, errorCode: 'PROCESSING_EXPIRED' }),
          ]);
      }
      await tx.query("UPDATE fw_requests SET status='failed',error=$3 WHERE scope_id=$1 AND status='processing' AND lease_expires_at<=$2", [row.scope_id, this.clock.now(), JSON.stringify({ code: 'PROCESSING_EXPIRED' })]);
    });
  }
  private async execute(input: AssessmentInput, registered: { binding: Binding; output?: ValidateFunction }) {
    const binding = registered.binding;
    const controller = new AbortController(); this.controllers.add(controller);
    const deadline = Math.min(this.clock.now() + (this.options.totalTimeoutMs ?? 75000), input.notAfter ?? Infinity);
    const totalTimer = setTimeout(() => controller.abort(), Math.max(0, deadline - this.clock.now()));
    let returnedAttempt: number | null = null;
    let judged = false;
    let prepared: Prepared | undefined;
    try {
      await this.options.hook?.('claimed', input);
      prepared = await binding.prepare(input.input, input.scopeId);
      let proposal: Json = null;
      if (binding.mode === 'assessment') {
        const worldview = await this.store.worldview?.(input.scopeId);
        const memories = await this.store.contextMemory(input.scopeId, prepared.visibility ?? ['public'], prepared.requiredMemoryIds, prepared.subjectIds, prepared.tags);
        let context: ReturnType<typeof buildContext>;
        try {
          context = buildContext({ worldview, facts: prepared.facts, promptParts: prepared.promptParts,
            instructions: prepared.instructions, input: input.input, schema: binding.outputSchema!, ...memories,
            counter: this.options.counter, inputBudget: this.options.inputBudget, outputBudget: this.options.outputBudget, window: this.options.modelWindow });
        } catch (error) {
          if (error instanceof HarnessError && error.code === 'CONTEXT_TOO_LARGE') {
            await this.logModelEvent(this.store.pool, input, prepared, 'model.context_rejected.v1', 'rejected',
              { attempt: 1, errorCode: error.code });
          }
          throw error;
        }
        const retry = this.options.networkRetry;
        const maxAttempts = retry?.maxAttempts ?? 2;
        let networkRetries = 0;
        let repairUsed = false;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          if (this.clock.now() >= deadline) throw new HarnessError('MODEL_TIMEOUT');
          const messages = [...context.messages];
          if (repairUsed) messages.push({ role: 'system', content: 'Your previous response did not match OUTPUT_SCHEMA. Return only a valid JSON object with exactly the required fields and allowed values.' });
          if ((this.options.counter ?? conservativeCounter)(messages) > context.inputBudget) {
            await this.logModelEvent(this.store.pool, input, prepared, 'model.context_rejected.v1', 'rejected',
              { attempt, errorCode: 'CONTEXT_TOO_LARGE' });
            throw new HarnessError('CONTEXT_TOO_LARGE');
          }
          const request: ModelRequest = { requestId: input.requestId, attempt, messages, outputSchema: binding.outputSchema!, maxOutputTokens: context.outputBudget };
          const release = retry?.gate.acquire(retry.key, attempt > 1, this.clock.now());
          if (retry && !release) {
            await this.logModelEvent(this.store.pool, input, prepared, 'model.call.skipped.v1', 'failed',
              { attempt, reason: 'RETRY_GATE_CLOSED' });
            throw new HarnessError('MODEL_UNAVAILABLE', 503, 'RETRY_GATE_CLOSED');
          }
          const started = this.clock.now();
          let response;
          let callFailure: { error: unknown } | undefined;
          let startedLogged = false;
          try {
            await this.logModelEvent(this.store.pool, input, prepared, 'model.call.started.v1', 'started', {
              attempt, deadlineAt: deadline, modelRequest: request,
              promptLayoutVersion: prepared.promptParts?.sharedKnowledge?.length ? 4 : prepared.promptParts ? 2 : 1,
              ...(prepared.promptParts ? { sharedPublicDigest: createHash('sha256').update(JSON.stringify(prepared.promptParts.sharedPublicFacts)).digest('hex'),
                sharedPublicBytes: Buffer.byteLength(JSON.stringify(prepared.promptParts.sharedPublicFacts), 'utf8') } : {}),
              contextIds: context.contextIds, worldId: worldview?.worldId ?? null,
              worldVersion: worldview?.version ?? null, worldDigest: worldview?.digest ?? null,
            });
            startedLogged = true;
            const timeoutMs = retry && attempt > 1
              ? Math.min(this.options.callTimeoutMs ?? 30000, deadline - this.clock.now() - retry.commitReserveMs)
              : undefined;
            response = await this.callModel(request, controller.signal, timeoutMs);
            retry?.gate.success(retry.key);
          } catch (error) {
            callFailure = { error };
            if (startedLogged && error instanceof HarnessError && error.code === 'MODEL_UNAVAILABLE' &&
                error.diagnostics?.transportCategory === 'network') retry?.gate.networkFailure(retry.key, this.clock.now());
            if (startedLogged) await this.logModelEvent(this.store.pool, input, prepared, 'model.call.failed.v1', 'failed', {
              attempt, latencyMs: Math.max(0, this.clock.now() - started),
              errorCode: error instanceof HarnessError ? error.code : 'MODEL_UNAVAILABLE',
              ...(error instanceof HarnessError && error.diagnostics ? error.diagnostics : {}),
            });
          } finally {
            release?.();
          }
          if (callFailure) {
            const error = callFailure.error;
            const networkFailure = error instanceof HarnessError && error.code === 'MODEL_UNAVAILABLE' &&
              error.diagnostics?.transportCategory === 'network';
            if (!retry || !networkFailure || attempt >= maxAttempts || networkRetries >= retry.delaysMs.length) throw error;
            const delayMs = retry.delaysMs[networkRetries] + Math.floor(Math.random() * (retry.jitterMs + 1));
            networkRetries++;
            if (deadline - this.clock.now() - delayMs < retry.minRemainingMs) {
              await this.logModelEvent(this.store.pool, input, prepared, 'model.retry.skipped.v1', 'failed',
                { attempt, reason: 'INSUFFICIENT_TIME' });
              throw error;
            }
            await this.logModelEvent(this.store.pool, input, prepared, 'model.retry.scheduled.v1', 'started',
              { attempt, nextAttempt: attempt + 1, delayMs });
            await this.waitForRetry(delayMs, controller.signal);
            if (deadline - this.clock.now() < retry.minRemainingMs) throw error;
            await this.ensureRetryCurrent(binding, input, deadline);
            continue;
          }
          let valid = false;
          const received = response!;
          const rawTextBytes = Buffer.byteLength(received.rawText, 'utf8');
          try { if (rawTextBytes <= 16384) { proposal = JSON.parse(received.rawText); valid = !!registered.output!(proposal); } } catch { /* Invalid JSON is repairable. */ }
          await this.logModelEvent(this.store.pool, input, prepared, 'model.call.finished.v1', 'succeeded', {
            attempt, rawText: rawTextBytes <= 65536 ? received.rawText : null,
            rawTextBytes, rawTextComplete: rawTextBytes <= 65536,
            ...(rawTextBytes > 65536 ? { rawTextDigest: createHash('sha256').update(received.rawText).digest('hex') } : {}),
            model: received.model, usage: received.usage,
            latencyMs: Math.max(0, this.clock.now() - started), schemaValid: valid,
          });
          returnedAttempt = attempt;
          if (valid) break;
          if (repairUsed || attempt === maxAttempts) throw new HarnessError('MODEL_INVALID_OUTPUT');
          repairUsed = true;
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
        const result = await binding.apply(tx, proposal, { scopeId: input.scopeId, requestId: input.requestId, input: input.input, gameVersion: prepared!.gameVersion });
        await this.options.hook?.('host', input);
        await this.store.applyMemory(tx, input.scopeId, result.memoryChanges);
        await this.options.hook?.('memory', input);
        if (controller.signal.aborted || this.clock.now() >= deadline || Number(request.lease_expires_at) <= this.clock.now()) throw new HarnessError('PROCESSING_EXPIRED');
        await tx.query('UPDATE fw_scopes SET memory_version=memory_version+1 WHERE id=$1', [input.scopeId]);
        await tx.query("UPDATE fw_requests SET status='committed',proposal=$3,result=$4,memory_version=$5 WHERE scope_id=$1 AND request_id=$2", [input.scopeId,input.requestId,JSON.stringify(proposal),JSON.stringify(result.result),scope.memory_version+1]);
        if (returnedAttempt !== null) await this.logModelEvent(tx, input, prepared!, 'model.call.judged.v1', 'succeeded', {
          attempt: returnedAttempt, gameCommitted: true,
        });
      });
      judged = true;
      await this.options.hook?.('committed', input);
    } catch (error) {
      const e = error instanceof HarnessError ? error : new HarnessError('INTERNAL_ERROR');
      const status = ['MODEL_INVALID_OUTPUT','RULE_REJECTED','INVALID_INPUT'].includes(e.code) ? 'rejected' : 'failed';
      await this.store.pool.query("UPDATE fw_requests SET status=$3,error=$4 WHERE scope_id=$1 AND request_id=$2 AND status='processing'", [input.scopeId,input.requestId,status,JSON.stringify({ code: e.code, ...(e.detail ? { detail: e.detail } : {}) })]);
      if (returnedAttempt !== null && !judged && prepared) await this.logModelEvent(this.store.pool, input, prepared,
        'model.call.judged.v1', status, { attempt: returnedAttempt, gameCommitted: false, errorCode: e.code });
    } finally { clearTimeout(totalTimer); this.controllers.delete(controller); }
  }
  private async ensureRetryCurrent(binding: Binding, input: AssessmentInput, deadline: number): Promise<void> {
    if (this.clock.now() >= deadline) throw new HarnessError('MODEL_TIMEOUT');
    await this.store.transaction(async tx => {
      await binding.lockResources?.(tx, input.scopeId);
      const request = (await tx.query('SELECT status,lease_expires_at FROM fw_requests WHERE scope_id=$1 AND request_id=$2',
        [input.scopeId, input.requestId])).rows[0];
      if (!request || request.status !== 'processing' || Number(request.lease_expires_at) <= this.clock.now()) {
        throw new HarnessError('PROCESSING_EXPIRED');
      }
    });
  }

  private async waitForRetry(delayMs: number, signal: AbortSignal): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      if (signal.aborted) { reject(new HarnessError('MODEL_TIMEOUT')); return; }
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, delayMs);
      const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new HarnessError('MODEL_TIMEOUT')); };
      signal.addEventListener('abort', abort, { once: true });
    });
  }

  private async callModel(request: ModelRequest, parent: AbortSignal, timeoutMs = this.options.callTimeoutMs ?? 30000) {
    const child = new AbortController();
    const abort = () => child.abort(); parent.addEventListener('abort', abort, { once: true });
    if (parent.aborted) child.abort();
    const timer = setTimeout(() => child.abort(), Math.max(0, timeoutMs));
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


