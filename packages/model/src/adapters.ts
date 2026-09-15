import { HarnessError, type ModelAdapter, type ModelRequest, type ModelResponse } from '@game-ai/core';

export class ScriptedModel implements ModelAdapter {
  calls: ModelRequest[] = [];
  constructor(private script: (request: ModelRequest, signal: AbortSignal) => Promise<string> | string) {}
  async generate(request: ModelRequest, signal: AbortSignal): Promise<ModelResponse> {
    this.calls.push(structuredClone(request));
    return { rawText: await this.script(request, signal), model: 'mock-v1', usage: { inputTokens: 100, outputTokens: 20 } };
  }
}

// A server-only adapter for providers exposing the Chat Completions JSON-schema protocol.
export class ChatCompletionsAdapter implements ModelAdapter {
  constructor(private config: { baseUrl: string; apiKey: string; model: string; protocol?: 'json-schema' | 'deepseek' }) {
    const url = new URL(config.baseUrl);
    if (url.protocol !== 'https:' && !['localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw new Error('Provider must use HTTPS');
  }
  async generate(request: ModelRequest, signal: AbortSignal): Promise<ModelResponse> {
    const deepseek = this.config.protocol === 'deepseek';
    const payload: Record<string, unknown> = { model: this.config.model, messages: request.messages };
    if (deepseek) {
      payload.max_tokens = request.maxOutputTokens;
      payload.response_format = { type: 'json_object' };
      payload.thinking = { type: 'disabled' };
    } else {
      payload.max_completion_tokens = request.maxOutputTokens;
      payload.response_format = { type: 'json_schema', json_schema: { name: 'assessment', strict: true, schema: request.outputSchema } };
    }
    const response = await fetch(this.config.baseUrl.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST', signal, headers: { 'content-type': 'application/json', authorization: `Bearer ${this.config.apiKey}` },
      body: JSON.stringify(payload),
    });
    if (!response.ok) { await response.body?.cancel(); throw new HarnessError('MODEL_UNAVAILABLE'); }
    // Bound the transport envelope as well as the eventual model text.
    const reader = response.body?.getReader(); if (!reader) throw new HarnessError('MODEL_UNAVAILABLE');
    let size = 0; const parts: Uint8Array[] = [];
    try {
      while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 262144) { await reader.cancel(); throw new HarnessError('MODEL_UNAVAILABLE'); } parts.push(value); }
    } finally { reader.releaseLock(); }
    let body: any;
    try { body = JSON.parse(Buffer.concat(parts).toString('utf8')); }
    catch { throw new HarnessError('MODEL_UNAVAILABLE'); }
    const text = body.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) throw new HarnessError('MODEL_UNAVAILABLE');
    return { rawText: text, model: this.config.model, usage: Number.isFinite(body.usage?.prompt_tokens) && Number.isFinite(body.usage?.completion_tokens)
      ? { inputTokens: body.usage.prompt_tokens, outputTokens: body.usage.completion_tokens } : null };
  }
}

