import { loadRobotUsers, publicRobot, robotRoot } from './robot-users.ts';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DemoRooms } from '../../../mods/werewolf/src/demo.ts';
import type { DemoSnapshot } from '../../shared/werewolf.ts';
import type { WerewolfModelService } from './werewolf-model-service.ts';
import { WerewolfModelService as ModelService } from './werewolf-model-service.ts';
import { PostgresStore } from '@game-ai/storage';
import pg from 'pg';

export async function werewolfDemoRoutes(app: FastifyInstance, options: { rooms?: DemoRooms; modelService?: WerewolfModelService } = {}) {
  const rooms = options.rooms ?? new DemoRooms();
  const robots = loadRobotUsers();
  const local = (ip: string) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip);
  const starts = new Map<string, { signature: string; id: string; at: number }>();
  app.get('/api/robot-users', async () => robots.map(user => ({ ...publicRobot(user),
    controller: user.control.kind,
    available: user.control.kind === 'script' || !!options.modelService,
    ...(user.control.kind === 'model' && !options.modelService ? { unavailableReason: '模型服务未配置' } : {}),
  })));
  if (options.modelService) {
    app.post<{ Body: { requestId: string; seed: number; userIds: string[] } }>('/api/werewolf/model/start', {
      schema: { body: { type: 'object', additionalProperties: false, required: ['requestId', 'seed', 'userIds'],
        properties: { requestId: { type: 'string', minLength: 8, maxLength: 80 }, seed: { type: 'integer', minimum: 0, maximum: 4294967295 },
          userIds: { type: 'array', minItems: 12, maxItems: 12, uniqueItems: true, items: { type: 'string' } } } } },
    }, async (request, reply) => local(request.ip)
      ? options.modelService!.start(request.body.requestId, request.body.seed, request.body.userIds)
      : reply.code(403).send({ error: 'LOCAL_ONLY' }));
    app.get<{ Params: { id: string }; Querystring: { seat?: string } }>('/api/werewolf/model/:id', {
      schema: { querystring: { type: 'object', additionalProperties: false,
        properties: { seat: { type: 'string', pattern: '^(?:[1-9]|1[0-2])$' } } } },
    }, async (request, reply) => {
      const viewer = request.query.seat === undefined ? null : Number(request.query.seat);
      if (viewer !== null && !local(request.ip)) return reply.code(403).send({ error: 'LOCAL_ONLY' });
      return options.modelService!.get(request.params.id, viewer);
    });
  }
  await app.register(fastifyStatic, { root: resolve(robotRoot,'assets'), prefix:'/robot-assets/', decorateReply:false });
  app.post<{ Body: { requestId: string; seed: number; userIds: string[] } }>('/api/werewolf/demo/start', {
    schema:{body:{type:'object',additionalProperties:false,required:['requestId','seed','userIds'],properties:{requestId:{type:'string',minLength:8,maxLength:80},seed:{type:'integer',minimum:0,maximum:4294967295},userIds:{type:'array',minItems:12,maxItems:12,uniqueItems:true,items:{type:'string'}}}}},
  }, async (request, reply) => {
    const {requestId, seed, userIds} = request.body;
    const roster = userIds.map(id => robots.find(user => user.userId === id));
    if (roster.some(user => !user)) return reply.code(400).send({error:'阵容包含未知Robot用户'});
    if (roster.some(user => user?.control.kind === 'model')) return reply.code(400).send({ error: '模型Robot暂未接入，当前仅支持脚本用户' });
    const signature = JSON.stringify({seed,userIds});
    const old = starts.get(requestId);
    if (old) {
      if (old.signature !== signature) return reply.code(409).send({error:'同一开局请求的阵容不可改变'});
      return rooms.get(old.id);
    }
    for (const [key, start] of starts) if (Date.now()-start.at > 3_600_000) starts.delete(key);
    if (starts.size >= 100) return reply.code(503).send({error:'开局请求过多，请稍后重试'});
    const game = rooms.create(seed,'random',roster as typeof robots);
    starts.set(requestId,{signature,id:game.id,at:Date.now()});
    return game;
  });
  const clock = setInterval(() => rooms.tick(), 100);
  clock.unref();
  const modelRecovery = options.modelService ? setInterval(() => {
    void options.modelService!.recover().catch(error => {
      app.log.error({ code: error instanceof Error ? error.message : 'RECOVERY_FAILED' }, 'Werewolf model recovery failed');
    });
  }, 5000) : undefined;
  modelRecovery?.unref();
  app.addHook('onClose', async () => { clearInterval(clock); if (modelRecovery) clearInterval(modelRecovery); });
  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && new URL(origin).host !== request.headers.host) return reply.code(403).send({ error: 'ORIGIN_REJECTED' });
  });
  app.setErrorHandler((error: Error, _request, reply) => {
    const status = error.message === 'DEMO_NOT_FOUND' ? 404 : error.message === 'REVISION_CONFLICT' ? 409 : error.message === 'DEMO_CAPACITY' ? 503 : 400;
    reply.code(status).send({ error: status === 404 ? '演示已过期，请重开' : status === 409 ? '进度已改变，请刷新' : '暂时无法继续，请重试' });
  });
  app.post<{ Body: { seed: number; strategy: 'fixed' | 'random' } }>('/api/werewolf/demo', {
    schema: { body: { type: 'object', additionalProperties: false, required: ['seed', 'strategy'], properties: {
      seed: { type: 'integer', minimum: 0, maximum: 4294967295 }, strategy: { enum: ['fixed', 'random'] },
    } } },
  }, async (request): Promise<DemoSnapshot> => rooms.create(request.body.seed, request.body.strategy));
  app.get<{ Params: { id: string }; Querystring: { seat?: string } }>('/api/werewolf/demo/:id', {
    schema: { querystring: { type: 'object', additionalProperties: false, properties: { seat: { type: 'string', pattern: '^(?:[1-9]|1[0-2])$' } } } },
  }, async (request): Promise<DemoSnapshot> => rooms.get(request.params.id, request.query.seat === undefined ? null : Number(request.query.seat)));

}

export async function buildWerewolfDemo(options: { rooms?: DemoRooms; modelService?: WerewolfModelService } = {}) {
  const app = Fastify({ bodyLimit: 1024, ajv: { customOptions: { removeAdditional: false, coerceTypes: false } } });
  let modelService = options.modelService;
  let ownStore: PostgresStore | undefined;
  if (!modelService && process.env.WEREWOLF_MODEL_ENABLED === 'true') {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for model rooms');
    ownStore = new PostgresStore(new pg.Pool({ connectionString: process.env.DATABASE_URL }));
    try {
      modelService = new ModelService(ownStore);
      await modelService.migrate();
      await modelService.recover();
    } catch (error) {
      await ownStore.pool.end();
      throw error;
    }
  }
  await app.register(werewolfDemoRoutes, { ...options, modelService });
  if (ownStore) app.addHook('onClose', async () => { await modelService!.close(); await ownStore.pool.end(); });
  app.get('/', (_request, reply) => reply.redirect('/werewolf'));
  await app.register(fastifyStatic, { root: resolve('dist'), prefix: '/' });
  app.get('/werewolf', (_request, reply) => reply.sendFile('index.html'));
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const app = await buildWerewolfDemo();
  await app.listen({ port: Number(process.env.WEREWOLF_PORT ?? 4318), host: '127.0.0.1' });
  console.log(`狼人杀演示：http://127.0.0.1:${process.env.WEREWOLF_PORT ?? 4318}/werewolf`);
}
