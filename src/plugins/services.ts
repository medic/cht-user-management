import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { MemCache } from "../services/cache";
import { UploadManager } from "../services/upload-manager";

async function services(fastify: FastifyInstance) {
  const cache = new MemCache();
  const uploadManager = new UploadManager(cache);
  fastify.decorate("cache", cache);
  fastify.decorate("uploadManager", uploadManager);
}

export default fp(services, {
  name: "services",
});
