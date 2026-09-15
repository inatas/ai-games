import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { Harness, HarnessError, type ModelAdapter, type Transaction } from '@game-ai/core';
import { Identity, registerIdentityRoutes, sessionToken } from '@game-ai/identity';
import { PostgresStore, loadWorldview } from '@game-ai/storage';
import { actions, initializeGame, gameBinding, migrateGame, publicState } from '../../../examples/wuxia-mud/src/game.ts';

export async function buildApp(store: PostgresStore, model: ModelAdapter, mode = 'mock') {
  await store.migrate();
  await migrateGame(store);
  const worldview = await loadWorldview(process.env.WORLDVIEW_PATH ?? 'examples/wuxia-mud/WORLD.md', process.env.WORLD_ID ?? 'wuxia', process.env.WORLD_VERSION ?? '1');
  await store.registerWorldview(worldview);
  const identity = new Identity(store, { worldview, initialize: (tx, id) => initializeGame(store, tx, id) });
  const harness = new Harness(store, model);
  actions.forEach(a => harness.register(gameBinding(store, a)));
  await harness.recover();
  const app = Fastify({ logger: false, bodyLimit: 32768 });
  const recovery = setInterval(() => { void harness.recover().catch(() => {}); }, 5000);
  recovery.unref();
  app.addHook('onClose', async () => { clearInterval(recovery); await harness.close(); });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HarnessError) return reply.code(error.httpStatus).send({ code: error.code, detail: error.detail });
    const err = error as { validation?: unknown; statusCode?: number };
    if (err.validation) return reply.code(400).send({ code: 'INVALID_INPUT' });
    return reply.code(err.statusCode && err.statusCode < 500 ? err.statusCode : 500).send({ code: 'INTERNAL_ERROR' });
  });
  registerIdentityRoutes(app, identity, process.env.COOKIE_SECURE === 'true');
  app.get('/api/health', async () => ({ status: 'ok', modelMode: mode }));

  async function authorize(tx: Transaction, request: any) {
    const id = request.params.id;
    await identity.authorizeCurrent(tx, sessionToken(request), id);
    await tx.query('SELECT id FROM fw_scopes WHERE id=$1 FOR SHARE', [id]);
    return (await tx.query('SELECT c.*,s.memory_version FROM wuxia_characters c JOIN fw_scopes s ON c.scope_id=s.id WHERE c.scope_id=$1', [id])).rows[0];
  }
  app.get('/api/wuxia/games/:id', async request => store.transaction(async tx => {
    const row = await authorize(tx, request);
    const memory = await store.memory(row.scope_id, ['public'], tx);
    return { id: row.scope_id, state: publicState(row), memoryVersion: row.memory_version, events: memory.filter(m => m.kind === 'event'), openItems: memory.filter(m => m.kind === 'item') };
  }));
  app.post('/api/wuxia/games/:id/actions', { schema: { body: { type: 'object', additionalProperties: false, required: ['requestId', 'expectedMemoryVersion', 'action', 'note'], properties: { requestId: { type: 'string', pattern: '^[0-9a-fA-F-]{36}$' }, expectedMemoryVersion: { type: 'integer', minimum: 0 }, action: { type: 'string', enum: actions }, note: { type: 'string', maxLength: 200 } } } } }, async (request, reply) => {
    const body = request.body as any;
    const id = (request.params as { id: string }).id;
    const result = await harness.submit({ scopeId: id, requestId: body.requestId, expectedMemoryVersion: body.expectedMemoryVersion, bindingId: `wuxia.${body.action}`, bindingVersion: '1', input: { note: body.note } }, tx => identity.authorizeCurrent(tx, sessionToken(request), id));
    return reply.code(result.status === 'processing' ? 202 : 200).send(result);
  });
  app.get('/api/wuxia/games/:id/requests/:requestId', async request => store.transaction(async tx => {
    const row = await authorize(tx, request);
    return harness.get(row.scope_id, (request.params as { requestId: string }).requestId, tx);
  }));
  const root = resolve('dist');
  if (existsSync(root)) await app.register(fastifyStatic, { root });
  return { app, harness, identity };
}
