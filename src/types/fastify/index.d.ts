import { FastifyInstance } from 'fastify';
import { ChtSession } from '../../lib/cht-api';
import SessionCache from '../../services/session-cache';

declare module 'fastify' {
  interface FastifyInstance {
    uploadManager: UploadManager;
  }

  interface FastifyRequest {
    unauthenticated: boolean;
    chtSession: ChtSession;
    sessionCache: SessionCache;
  }
}

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      COOKIE_PRIVATE_KEY: string;
    }
  }
}
