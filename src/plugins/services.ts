import { FastifyInstance } from "fastify";
import { env } from "process";
import fp from "fastify-plugin";
import { ChtApi } from "../lib/cht";
import { getHierarchy, getRoles } from "../lib/utils";
import { MemCache } from "../services/cache";
import { UploadManager } from "../services/job";

declare module "fastify" {
  interface FastifyInstance {
    cache: MemCache;
    cht: ChtApi;
    jobManager: UploadManager;
  }
}

async function services(fastify: FastifyInstance) {
  const client = new ChtApi({
    User: env.CHT_USER!!,
    Pass: env.CHT_PASSWORD!!,
    Domain: env.CHT_DOMAIN!!,
  });

  const settings = await client.getAppSettings();
  const hierarchy = getHierarchy(settings);
  const roles = getRoles(settings);
  const cache = new MemCache(hierarchy, roles);

  const uploadManager = new UploadManager(client, cache);

  fastify.decorate("cht", client);
  fastify.decorate("cache", cache);
  fastify.decorate("jobManager", uploadManager);
}

export default fp(services, {
  name: "services",
});
