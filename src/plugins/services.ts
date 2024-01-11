import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { UploadManager } from "../services/upload-manager";

async function services(fastify: FastifyInstance) {
  const uploadManager = new UploadManager();
  fastify.decorate("uploadManager", uploadManager);
}

export default fp(services, {
  name: "services",
});
