import { expect } from 'chai';
import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import Auth from '../src/lib/authentication';
import SessionCache from '../src/services/session-cache';

describe('server.ts auth hook', () => {
  let fastify: FastifyInstance;

  beforeEach(async () => {
    fastify = Fastify();
    await fastify.register(cookie);

    fastify.addHook('preValidation', async (req: FastifyRequest, reply: FastifyReply) => {
      if (req.unauthenticated) {
        return;
      }

      if (req.routeOptions?.url && ['/login', '/_healthz'].includes(req.routeOptions.url)) {
        return;
      }

      const cookieToken = req.cookies[Auth.AUTH_COOKIE_NAME] as string;
      if (!cookieToken) {
        return reply.redirect('/login');
      }

      try {
        const chtSession = Auth.createCookieSession(cookieToken);
        req.chtSession = chtSession;
        req.sessionCache = SessionCache.getForSession(chtSession);
      } catch {
        return reply.redirect('/login');
      }
    });

    fastify.get('/', async () => 'hello');
    fastify.get('/_healthz', async () => 'OK');
  });

  afterEach(async () => {
    await fastify.close();
  });

  it('should redirect unauthenticated GET / requests to /login with 302 without throwing', async () => {
    const response = await fastify.inject({
      method: 'GET',
      url: '/',
    });

    expect(response.statusCode).to.equal(302);
    expect(response.headers.location).to.equal('/login');
  });

  it('should redirect requests with invalid cookie to /login with 302', async () => {
    const response = await fastify.inject({
      method: 'GET',
      url: '/',
      cookies: {
        [Auth.AUTH_COOKIE_NAME]: 'invalid-token',
      },
    });

    expect(response.statusCode).to.equal(302);
    expect(response.headers.location).to.equal('/login');
  });

  it('should allow access to /_healthz without authentication', async () => {
    const response = await fastify.inject({
      method: 'GET',
      url: '/_healthz',
    });

    expect(response.statusCode).to.equal(200);
    expect(response.payload).to.equal('OK');
  });
});
