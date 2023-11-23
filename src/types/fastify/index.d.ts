import { FastifyInstance } from "fastify";
import { ChtSession } from "../../lib/cht";

declare module "fastify" {
  interface FastifyInstance {
    cache: MemCache;
    uploadManager: UploadManager;
  }

  interface FastifyRequest {
    unauthenticated: boolean;
    chtSession: ChtSession;
  }
}

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      COOKIE_PRIVATE_KEY: string;
    }
  }
}
