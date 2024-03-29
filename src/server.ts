import Fastify, { FastifyInstance, FastifyReply, FastifyRequest, FastifyServerOptions } from 'fastify';
import autoload from '@fastify/autoload';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import view from '@fastify/view';
import { Liquid } from 'liquidjs';
import { FastifySSEPlugin } from 'fastify-sse-v2';
import path from 'path';

import Auth from './lib/authentication';
import SessionCache from './services/session-cache';

const build = (opts: FastifyServerOptions): FastifyInstance => {
  const fastify = Fastify(opts);
  fastify.register(formbody);
  fastify.register(multipart);
  fastify.register(FastifySSEPlugin);
  fastify.register(cookie);
  fastify.register(view, {
    engine: {
      liquid: new Liquid({ extname: '.html', root: 'src/liquid', jekyllInclude: true, dynamicPartials: true }),
    },
  });
  fastify.register(autoload, {
    dir: path.join(__dirname, 'plugins'),
  });
  fastify.register(autoload, {
    dir: path.join(__dirname, 'routes'),
  });
  fastify.register(fastifyStatic, {
    root: path.join(__dirname, '../src/public'),
    prefix: '/public/',
    serve: true,
  });

  Auth.assertEnvironmentSetup();

  fastify.addHook('preValidation', async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.unauthenticated || req.routerPath === '/public/*') {
      return;
    }

    const cookieToken = req.cookies[Auth.AUTH_COOKIE_NAME] as string;
    if (!cookieToken) {
      reply.redirect('/login');
      throw new Error('user must login');
    }

    try {
      const chtSession = Auth.decodeToken(cookieToken);
      req.chtSession = chtSession;
      req.sessionCache = SessionCache.getForSession(chtSession);
    } catch (e) {
      reply.redirect('/login');
      throw e;
    }
  });

  return fastify;
};

export default build;
