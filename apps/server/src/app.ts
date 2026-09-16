import Fastify, { type RouteOptions } from 'fastify';
import fastifyStatic from '@fastify/static';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { Harness, HarnessError, type ModelAdapter, type Transaction } from '@game-ai/core';
import { Identity, registerIdentityRoutes, sessionToken } from '@game-ai/identity';
import { PostgresStore, loadWorldview } from '@game-ai/storage';
import { qingxiHost } from '../../../mods/qingxi/src/host.ts';
import { socialProjection, sendMessage, mutateParty, heartbeat, lockRealm, retireCharacter, type ModHost } from '@game-ai/mud-core';

export async function buildApp(store: PostgresStore, model: ModelAdapter, mode = 'mock', host: ModHost = qingxiHost(store)) {
  const actions=host.actions;
  const bindings=host.bindings();
  const expected=new Set(actions.map(action=>`${host.prefix}.${action}`));
  const reservedFields=new Set(['requestId','expectedMemoryVersion','action','note']);
  if (!host.id || !host.prefix || !actions.length || expected.size!==actions.length ||
      bindings.length!==actions.length || new Set(bindings.map(binding=>binding.id)).size!==bindings.length ||
      bindings.some(binding=>!expected.has(binding.id)||binding.version!=='1') ||
      new Set(host.fields).size!==host.fields.length || host.fields.some(field=>reservedFields.has(field))) {
    throw new Error('MOD_BINDINGS_INVALID');
  }
  await store.migrate();
  await host.migrate();
  const configuredPath=process.env.WORLDVIEW_PATH==='examples/wuxia-mud/WORLD.md'?host.worldviewPath:process.env.WORLDVIEW_PATH;
  const worldview = await loadWorldview(configuredPath ?? host.worldviewPath, process.env.WORLD_ID ?? host.worldId, process.env.WORLD_VERSION ?? host.worldVersion);
  await store.registerWorldview(worldview);
  const identity = new Identity(store, { worldview, initialize: host.initialize, lockResources: lockRealm, retire: retireCharacter });
  const harness = new Harness(store, model);
  bindings.forEach(binding=>harness.register(binding));
  await harness.recover();
  const app = Fastify({ logger: false, bodyLimit: 32768, ajv: { customOptions: { removeAdditional: false, coerceTypes: false } } });
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
  const mudRoutes: RouteOptions[]=[];
  app.addHook('onRoute', options=>{
    const prefix='/api/wuxia/games/:id';
    if(options.method!=='HEAD'&&options.url.startsWith(prefix)) mudRoutes.push({...options,url:'/api/mud'+(options.url.slice(prefix.length)||'/current'),preValidation:async request=>{
      const session=await identity.session(sessionToken(request));
      (request.params as Record<string,string>).id=session.currentScopeId;
    }} as RouteOptions);
  });

  async function authorize(tx: Transaction, request: any) {
    const id = request.params.id;
    await identity.authorizeCurrent(tx, sessionToken(request), id);
    const { realm } = await lockRealm(tx, id);
    if (realm.mod_id !== host.id) throw new HarnessError('FORBIDDEN', 403);
    await tx.query('SELECT id FROM fw_scopes WHERE id=$1 FOR SHARE', [id]);
    const scope = (await tx.query('SELECT id scope_id,memory_version FROM fw_scopes WHERE id=$1', [id])).rows[0];
    return { ...scope, realm };
  }
  app.get('/api/wuxia/games/:id', async request => store.transaction(async tx => {
    const row = await authorize(tx, request);
    const memory = await store.memory(row.scope_id, ['public'], tx);
    return { id: row.scope_id, scopeId: row.scope_id, memoryVersion: row.memory_version,
      ...(await host.snapshot(tx,row.scope_id)),
      realm: { id:row.realm.id, modId:row.realm.mod_id, modVersion:row.realm.mod_version,
        contentVersion:row.realm.content_version, worldviewVersion:row.realm.worldview_version, revision:row.realm.revision },
      ...(await socialProjection(tx, row.scope_id)), events: memory.filter(m => m.kind === 'event'), openItems: memory.filter(m => m.kind === 'item') };
  }));
  app.post('/api/wuxia/games/:id/actions', { schema: { body: { type: 'object', additionalProperties: false, required: ['requestId', 'expectedMemoryVersion', 'action', 'note'], properties: { requestId: { type: 'string', pattern: '^[0-9a-fA-F-]{36}$' }, expectedMemoryVersion: { type: 'integer', minimum: 0 }, action: { type: 'string', enum: actions }, note: { type: 'string', maxLength: 200 }, ...Object.fromEntries(host.fields.map(key => [key, { type: 'string', minLength: 1, maxLength: 80 }])) } } } }, async (request, reply) => {
    const body = request.body as any;
    const id = (request.params as { id: string }).id;
    const { requestId, expectedMemoryVersion, action, ...input } = body;
    const result = await harness.submit({ scopeId: id, requestId, expectedMemoryVersion, bindingId: `${host.prefix}.${action}`, bindingVersion: '1', input }, async tx => {
      await identity.authorizeCurrent(tx, sessionToken(request), id);
      const { realm } = await lockRealm(tx, id);
      if (realm.mod_id !== host.id) throw new HarnessError('FORBIDDEN', 403);
    });
    return reply.code(result.status === 'processing' ? 202 : 200).send(result);
  });
  app.get('/api/wuxia/games/:id/requests/:requestId', async request => store.transaction(async tx => {
    const row = await authorize(tx, request);
    return harness.get(row.scope_id, (request.params as { requestId: string }).requestId, tx);
  }));
  app.get('/api/wuxia/games/:id/social', async request => store.transaction(async tx => {
    const row = await authorize(tx, request); return socialProjection(tx, row.scope_id);
  }));
  app.post('/api/wuxia/games/:id/presence', async request => store.transaction(async tx => {
    const row=await authorize(tx,request); await heartbeat(tx,row.scope_id,sessionToken(request)); return {ok:true};
  }));
  app.post('/api/wuxia/games/:id/social/messages', { schema: { body: { type: 'object', additionalProperties: false, required: ['requestId','channel','body'], properties: {
    requestId: { type: 'string', pattern: '^[0-9a-fA-F-]{36}$' }, channel: { type: 'string', enum: ['say','tell','chat'] }, body: { type: 'string', minLength: 1, maxLength: 200 }, targetScopeId: { type: 'string', pattern: '^[0-9a-fA-F-]{36}$' },
  } } } }, async request => store.transaction(async tx => { const row = await authorize(tx, request); return sendMessage(tx, row.scope_id, request.body as any); }));
  app.post('/api/wuxia/games/:id/social/party', { schema: { body: { type: 'object', additionalProperties: false, required: ['requestId','action'], properties: {
    requestId: { type: 'string', pattern: '^[0-9a-fA-F-]{36}$' }, action: { type: 'string', enum: ['invite','accept','leave'] }, targetScopeId: { type: 'string', pattern: '^[0-9a-fA-F-]{36}$' }, inviteId: { type: 'string', pattern: '^[0-9a-fA-F-]{36}$' },
  } } } }, async request => store.transaction(async tx => { const row = await authorize(tx, request); return mutateParty(tx, row.scope_id, request.body as any); }));
  for(const route of mudRoutes) app.route(route);
  const root = resolve('dist');
  if (existsSync(root)) await app.register(fastifyStatic, { root });
  return { app, harness, identity };
}
