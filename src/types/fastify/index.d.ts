import ChtSession from '../../lib/cht-session';
import ExternalSourceAuthManager from '../../services/external-source-auth-manager';
import SessionCache from '../../services/session-cache';
import { UploadManager } from '../../services/upload-manager';

declare module 'fastify' {
  interface FastifyInstance {
    uploadManager: UploadManager;
    externalSourceAuthManager: ExternalSourceAuthManager;
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
      SECRET_KEY: string;
    }
  }
}
