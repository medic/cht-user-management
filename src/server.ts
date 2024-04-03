import autoload from '@fastify/autoload';
import cookie from '@fastify/cookie';
import Fastify, { FastifyInstance, FastifyReply, FastifyRequest, FastifyServerOptions } from 'fastify';
import { FastifySSEPlugin } from 'fastify-sse-v2';
import fastifyStatic from '@fastify/static';
import formbody from '@fastify/formbody';
import { Liquid } from 'liquidjs';
import multipart from '@fastify/multipart';
import path from 'path';
import * as semver from 'semver';
import view from '@fastify/view';

import Auth from './lib/authentication';
import SessionCache from './services/session-cache';
import { ChtApi_4_6, ChtApi_4_7 } from './lib/cht-api-override';
import { ChtApi } from './lib/cht-api';
import ChtSession from './lib/cht-session';

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
      req.chtApi = createChtApi(chtSession);
      req.sessionCache = SessionCache.getForSession(chtSession);
    } catch (e) {
      reply.redirect('/login');
      throw e;
    }
  });

  return fastify;
};

function createChtApi(chtSession: ChtSession): ChtApi {
  if (semver.gte(chtSession.chtCoreVersion, '4.5.0')) { // TODO: change when not testing on dev
    return new ChtApi_4_7(chtSession);
  }
  
  if (semver.gte(chtSession.chtCoreVersion, '4.6.0')) {
    return new ChtApi_4_6(chtSession);
  }

  return new ChtApi(chtSession);
}

export default build;
