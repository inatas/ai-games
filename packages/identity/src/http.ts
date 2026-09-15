import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { HarnessError } from '@game-ai/core';
import { Identity, sessionSeconds } from './identity.ts';

export function sessionToken(request: FastifyRequest) {
  return (request.headers.cookie ?? '').split(';').map(s => s.trim()).find(s => s.startsWith('harness_session='))?.slice('harness_session='.length) ?? '';
}
export function registerIdentityRoutes(app: FastifyInstance, identity: Identity, secure = false) {
  const cookie = (token: string, age = sessionSeconds) => `harness_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? '; Secure' : ''}`;
  const renew = (request: FastifyRequest, reply: FastifyReply) => reply.header('set-cookie', cookie(sessionToken(request)));
  app.addHook('onRequest', async request => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      let origin: URL;
      try { origin = new URL(request.headers.origin ?? ''); } catch { throw new HarnessError('FORBIDDEN', 403); }
      const expected = new URL(`${secure ? 'https' : 'http'}://${request.headers.host}`).origin;
      if (origin.origin !== expected) throw new HarnessError('FORBIDDEN', 403);
    }
  });
  app.addHook('onSend', async (request, reply, payload) => {
    if (request.url.startsWith('/api/')) {
      reply.header('cache-control', 'no-store');
      if (reply.statusCode < 400 && sessionToken(request) && !reply.hasHeader('set-cookie')) renew(request, reply);
    }
    return payload;
  });
  app.post('/api/auth/login', { schema: { body: { type: 'object', additionalProperties: false, required: ['username', 'password'], properties: { username: { type: 'string', maxLength: 128 }, password: { type: 'string', minLength: 8, maxLength: 128 } } } } }, async (request, reply) => {
    const body = request.body as { username: string; password: string };
    const { token, ...user } = await identity.login(body.username, body.password, request.ip);
    reply.header('set-cookie', cookie(token));
    return user;
  });
  app.get('/api/auth/session', async request => identity.session(sessionToken(request)));
  app.post('/api/auth/logout', async (request, reply) => {
    await identity.logout(sessionToken(request));
    reply.header('set-cookie', cookie('', 0));
    return { ok: true };
  });
  app.post('/api/game/current/reset', { schema: { body: { type: 'object', additionalProperties: false, required: ['requestId', 'expectedCurrentScopeId'], properties: { requestId: { type: 'string' }, expectedCurrentScopeId: { type: 'string' } } } } }, async request => {
    const body = request.body as { requestId: string; expectedCurrentScopeId: string };
    return identity.reset(sessionToken(request), body.requestId, body.expectedCurrentScopeId);
  });
}
