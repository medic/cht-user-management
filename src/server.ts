import Fastify, { FastifyInstance, FastifyReply, FastifyRequest, FastifyServerOptions } from 'fastify';
import autoload from '@fastify/autoload';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import fastifyCompress from '@fastify/compress';
import view from '@fastify/view';
import { Liquid } from 'liquidjs';
import { FastifySSEPlugin } from 'fastify-sse-v2';
import path from 'path';
import metricsPlugin from 'fastify-metrics';

import Auth from './lib/authentication';
import SessionCache from './services/session-cache';
import { checkRedisConnection } from './config/config-worker';
import { getChtConfQueue } from './lib/queues';

const UNAUTHENTICATED_ENDPOINTS = [
  '/public/*',
  '/metrics',
];

const build = (opts: FastifyServerOptions): FastifyInstance => {
  const fastify = Fastify(opts);
  fastify.register(formbody);
  fastify.register(multipart);
  fastify.register(FastifySSEPlugin);
  fastify.register(cookie);
  fastify.register(fastifyCompress);
  fastify.register(view, {
    engine: {
      liquid: new Liquid({ 
        extname: '.html', 
        root: 'src/liquid', 
        cache: process.env.NODE_ENV === 'production', 
        jekyllInclude: true, 
        dynamicPartials: true 
      }),
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
  
  fastify.register(metricsPlugin, {
    endpoint: '/fastify-metrics',
    routeMetrics: {
      enabled: {
        histogram: true,
        summary: true,
      }
    }
  });

  // hijack the /metrics response from fastify-metrics appending additional metrics
  fastify.addHook('onSend', async (request, reply, payload: string) => {
    if (request.routerPath === '/metrics') {
      const bullmqMetrics = await getChtConfQueue().bullQueue.exportPrometheusMetrics();
      return payload + bullmqMetrics;
    }
  });

  Auth.assertEnvironmentSetup();
  checkRedisConnection();

  fastify.addHook('preValidation', async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.unauthenticated) {
      return;
    }

    if (req.routeOptions.url && UNAUTHENTICATED_ENDPOINTS.includes(req.routeOptions.url)) {
      return;
    }

    const cookieToken = req.cookies[Auth.AUTH_COOKIE_NAME] as string;
    if (!cookieToken) {
      reply.redirect('/login');
      throw new Error('user must login');
    }

    try {
      const chtSession = Auth.createCookieSession(cookieToken);
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
