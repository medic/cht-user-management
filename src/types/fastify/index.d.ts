import { FastifyInstance } from "fastify";

declare module "fastify" {
  interface FastifyInstance {
    cache: MemCache;
    cht: ChtApi;
    jobManager: UploadManager;
  }

  interface FastifyRequest {
    unauthenticated: boolean;
  }
}

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      COOKIE_PRIVATE_KEY: string;
    }
  }
}
