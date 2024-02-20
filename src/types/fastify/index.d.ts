import ChtSession from '../../lib/cht-session';
import SessionCache from '../../services/session-cache';
import { UploadManager } from '../../services/upload-manager';

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
