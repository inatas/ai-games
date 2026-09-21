import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DemoRooms } from '../../../mods/werewolf/src/demo.ts';
import type { DemoSnapshot } from '../../shared/werewolf.ts';

export async function werewolfDemoRoutes(app: FastifyInstance) {
  const rooms = new DemoRooms();
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
  app.get<{ Params: { id: string } }>('/api/werewolf/demo/:id', async (request): Promise<DemoSnapshot> => rooms.get(request.params.id));
  app.post<{ Params: { id: string }; Body: { revision: number } }>('/api/werewolf/demo/:id/step', {
    schema: { body: { type: 'object', additionalProperties: false, required: ['revision'], properties: { revision: { type: 'integer', minimum: 0 } } } },
  }, async (request): Promise<DemoSnapshot> => rooms.step(request.params.id, request.body.revision));
}

export async function buildWerewolfDemo() {
  const app = Fastify({ bodyLimit: 1024, ajv: { customOptions: { removeAdditional: false, coerceTypes: false } } });
  await app.register(werewolfDemoRoutes);
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

