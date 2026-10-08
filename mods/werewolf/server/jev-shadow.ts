import { randomUUID } from 'node:crypto';
import type { ModelRequest } from '@game-ai/core';
import type { PostgresStore } from '@game-ai/storage';
import { jevChoiceSelectorVersion, jevDraw, sampleJevChoice } from './jev-choice-selector.ts';

const endpoint = 'https://api.typesafe.ai/v1/systemone';
const activationType = 'model.shadow.jev.activated.v1';
const shadowPrefix = 'model.shadow.jev.';
const terminalTypes = ['model.shadow.jev.finished.v1', 'model.shadow.jev.failed.v1', 'model.shadow.jev.unknown.v1'];

type JevRequest = {
  model: string;
  state: { messages: ModelRequest['messages'] };
  questions: { selected: { type: 'choice'; instructions: string; criteria: Record<string, string> } };
};

/** Return null when the logged request cannot be mapped to the exact legal SELECT set. */
export function buildJevSelectRequest(request: Pick<ModelRequest, 'messages' | 'outputSchema'>): JevRequest | null {
  if (!request || typeof request !== 'object') return null;
  const schema = request.outputSchema as { properties?: { selected?: { enum?: unknown } } };
  const ids = schema?.properties?.selected?.enum;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 255 ||
      ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length ||
      !Array.isArray(request.messages) || request.messages.some(message =>
        !message || !['system', 'user'].includes(message.role) || typeof message.content !== 'string')) return null;
  const current = request.messages.findLast(message => message.content.startsWith('CURRENT_FACTS:'));
  if (!current) return null;
  let action: { request_type?: string; options?: { id: string; value: unknown }[] };
  try {
    const facts = JSON.parse(current.content.slice('CURRENT_FACTS:'.length));
    action = facts.current_action;
  } catch { return null; }
  if (action?.request_type !== 'SELECT' || !Array.isArray(action.options) || action.options.length !== ids.length ||
      action.options.some(option => !option || typeof option.id !== 'string' || !('value' in option))) return null;
  const options = new Map(action.options.map(option => [option.id, option.value]));
  if (options.size !== ids.length || ids.some(id => !options.has(id))) return null;
  const criteria = Object.fromEntries(ids.map(id => [id, JSON.stringify(options.get(id))])) as Record<string, string>;
  return {
    model: 'jev-latest',
    state: { messages: request.messages },
    questions: { selected: {
      type: 'choice', instructions: '根据给定规则、事实和本人身份，在当前合法选项中选择最合适的一项。', criteria,
    } },
  };
}

type SourceRow = { sequence: string; request_id: string; room_id: string; user_id: string | null; details: {
  scopeId?: string; attempt: number; seatNo?: number; role?: string; scene?: string;
  modelProfile?: string; modelRequest: ModelRequest;
} };
type ShadowOptions = { apiKey: string; fetchFn?: typeof fetch; timeoutMs?: number; pollMs?: number };

/** MOD-only observer; it never returns a proposal to the room runtime. */
export class JevShadowWorker {
  private activationSequence: number | null = null;
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private closed = false;
  constructor(private store: PostgresStore, private options: ShadowOptions) {
    if (!options.apiKey) throw new Error('JEV_API_KEY_REQUIRED');
  }

  async activate(): Promise<void> {
    if (this.activationSequence !== null) return;
    this.activationSequence = await this.store.transaction(async tx => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('werewolf:jev-shadow:activation',0))");
      const existing = (await tx.query(`SELECT sequence FROM fw_event_log WHERE event_type=$1
        AND mod_id='werewolf' ORDER BY sequence LIMIT 1`, [activationType])).rows[0];
      if (existing) return Number(existing.sequence);
      const inserted = await tx.query(`INSERT INTO fw_event_log
        (event_id,event_type,occurred_at,mod_id,request_id,result,details)
        VALUES($1,$2,now(),'werewolf','jev-shadow-activation-v1','started',$3) RETURNING sequence`,
      [randomUUID(), activationType, JSON.stringify({ schemaVersion: 1 })]);
      return Number(inserted.rows[0].sequence);
    });
  }

  start(): void {
    if (this.timer || this.closed) return;
    this.timer = setInterval(() => { void this.runOnce().catch(() => {
      // A later poll retries unclaimed sources; paid attempts are never retried.
    }); }, this.options.pollMs ?? 1000);
    this.timer.unref();
  }

  async runOnce(): Promise<void> {
    if (this.closed) return;
    if (this.running) return this.running;
    this.running = this.scan();
    try { await this.running; } finally { this.running = undefined; }
  }

  private async scan(): Promise<void> {
    await this.activate();
    const rows = (await this.store.pool.query(`SELECT source.sequence,source.request_id,source.room_id,
      source.user_id,source.details FROM fw_event_log source
      WHERE source.sequence>$1 AND source.mod_id='werewolf'
        AND source.event_type='model.call.started.v1'
        AND source.details->>'attempt'='1' AND source.details->>'simulated'='false'
        AND source.details->'modelRequest'->'outputSchema'->'properties' ? 'selected'
        AND NOT EXISTS (SELECT 1 FROM fw_event_log shadow WHERE shadow.request_id=source.request_id
          AND shadow.event_type LIKE 'model.shadow.jev.%')
      ORDER BY source.sequence LIMIT 12`, [this.activationSequence])).rows as SourceRow[];
    await Promise.all(rows.map(row => this.process(row)));
    await this.markUnknown();
  }

  private async process(source: SourceRow): Promise<void> {
    const request = buildJevSelectRequest(source.details.modelRequest);
    const started = await this.store.transaction(async tx => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`jev-shadow:${source.request_id}`]);
      const existing = (await tx.query(`SELECT 1 FROM fw_event_log WHERE request_id=$1
        AND event_type LIKE 'model.shadow.jev.%' LIMIT 1`, [source.request_id])).rowCount;
      if (existing) return false;
      const eventType = request ? 'model.shadow.jev.started.v1' : 'model.shadow.jev.skipped.v1';
      await tx.query(`INSERT INTO fw_event_log
        (event_id,event_type,occurred_at,user_id,mod_id,room_id,request_id,result,details)
        VALUES($1,$2,now(),$3,'werewolf',$4,$5,$6,$7)`, [randomUUID(), eventType,
        source.user_id, source.room_id, source.request_id, request ? 'started' : 'skipped',
        JSON.stringify({ schemaVersion: 1, attempt: 1, scopeId: source.details.scopeId ?? null,
          sourceSequence: Number(source.sequence), seatNo: source.details.seatNo ?? null,
          role: source.details.role ?? null, scene: source.details.scene ?? null,
          modelProfile: source.details.modelProfile ?? null,
          ...(request ? { jevRequest: request } : { reason: 'SELECT_CONTEXT_MISMATCH' }) })]);
      return !!request;
    });
    if (!started || !request) return;
    const begun = Date.now();
    try {
      const response = await (this.options.fetchFn ?? fetch)(endpoint, {
        method: 'POST', headers: { Authorization: `Bearer ${this.options.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(request), signal: AbortSignal.timeout(this.options.timeoutMs ?? 15000),
      });
      if (!response.ok) {
        await this.finish(source, 'failed', { errorCode: 'JEV_HTTP_ERROR', httpStatus: response.status,
          latencyMs: Date.now() - begun });
        return;
      }
      const raw = await response.text();
      if (Buffer.byteLength(raw, 'utf8') > 65536) throw new Error('JEV_INVALID_RESPONSE');
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('JEV_INVALID_RESPONSE');
      const data = parsed as { model?: unknown; answers?: { selected?: {
        type?: unknown; choice?: unknown; confidence?: unknown; probabilities?: unknown;
      } }; usage?: { input_tokens?: unknown; output_tokens?: unknown } };
      const answer = data.answers?.selected;
      const ids = Object.keys(request.questions.selected.criteria);
      const probabilities = answer?.probabilities;
      const validProbability = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
      const draw = jevDraw(source.request_id);
      const selection = sampleJevChoice(ids, answer, draw);
      if (typeof data.model !== 'string' || !data.model || answer?.type !== 'choice' ||
          typeof answer.choice !== 'string' || !ids.includes(answer.choice) ||
          !validProbability(answer.confidence) || !probabilities || typeof probabilities !== 'object' ||
          Array.isArray(probabilities) || Object.keys(probabilities).length !== ids.length ||
          ids.some(id => !validProbability((probabilities as Record<string, unknown>)[id])) ||
          !selection ||
          !data.usage || !Number.isSafeInteger(data.usage.input_tokens) || Number(data.usage.input_tokens) < 0 ||
          !Number.isSafeInteger(data.usage.output_tokens) || Number(data.usage.output_tokens) < 0) {
        throw new Error('JEV_INVALID_RESPONSE');
      }
      const usage = data.usage!;
      await this.finish(source, 'finished', {
        schemaVersion: 2, providerResponse: data,
        model: data.model, choice: answer.choice, confidence: answer.confidence,
        probabilities, usage: { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens },
        selectorVersion: jevChoiceSelectorVersion, draw,
        normalizedProbabilities: selection.normalizedProbabilities,
        samplingProbabilities: selection.samplingProbabilities,
        sampledSelected: selection.sampledSelected,
        latencyMs: Date.now() - begun,
      });
    } catch (error) {
      const code = error instanceof SyntaxError || error instanceof Error && error.message === 'JEV_INVALID_RESPONSE' ? 'JEV_INVALID_RESPONSE'
        : error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError') ? 'JEV_TIMEOUT'
          : 'JEV_NETWORK_ERROR';
      await this.finish(source, 'failed', { errorCode: code, latencyMs: Date.now() - begun });
    }
  }

  private async finish(source: SourceRow, kind: 'finished' | 'failed', details: Record<string, unknown>): Promise<void> {
    await this.store.pool.query(`INSERT INTO fw_event_log
      (event_id,event_type,occurred_at,user_id,mod_id,room_id,request_id,result,details)
      VALUES($1,$2,now(),$3,'werewolf',$4,$5,$6,$7)`, [randomUUID(), `model.shadow.jev.${kind}.v1`,
      source.user_id, source.room_id, source.request_id, kind === 'finished' ? 'succeeded' : 'failed',
      JSON.stringify({ schemaVersion: 1, attempt: 1, sourceSequence: Number(source.sequence),
        seatNo: source.details.seatNo ?? null, role: source.details.role ?? null,
        scene: source.details.scene ?? null, scopeId: source.details.scopeId ?? null, ...details })]);
  }

  private async markUnknown(): Promise<void> {
    const rows = (await this.store.pool.query(`SELECT started.request_id,started.room_id,started.user_id,started.details
      FROM fw_event_log started WHERE started.mod_id='werewolf'
        AND started.event_type='model.shadow.jev.started.v1'
        AND started.occurred_at < now() - interval '30 seconds'
        AND NOT EXISTS (SELECT 1 FROM fw_event_log terminal WHERE terminal.request_id=started.request_id
          AND terminal.event_type=ANY($1::text[])) LIMIT 30`, [terminalTypes])).rows;
    for (const row of rows) await this.store.transaction(async tx => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`jev-shadow:${row.request_id}`]);
      if ((await tx.query(`SELECT 1 FROM fw_event_log WHERE request_id=$1
        AND event_type=ANY($2::text[]) LIMIT 1`, [row.request_id, terminalTypes])).rowCount) return;
      await tx.query(`INSERT INTO fw_event_log
        (event_id,event_type,occurred_at,user_id,mod_id,room_id,request_id,result,details)
        VALUES($1,'model.shadow.jev.unknown.v1',now(),$2,'werewolf',$3,$4,'unknown',$5)`, [
        randomUUID(), row.user_id, row.room_id, row.request_id,
        JSON.stringify({ schemaVersion: 1, attempt: 1, sourceSequence: row.details.sourceSequence,
          reason: 'RESULT_UNCONFIRMED' }),
      ]);
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }
}
