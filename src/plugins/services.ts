import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { UploadManager } from '../services/upload-manager';
import { RedisStore, UploadLoggerImpl } from '../services/upload-log';
import { checkRedisConnection } from '../config/config-worker';

async function services(fastify: FastifyInstance) {
  const redis = await checkRedisConnection();
  const redisStore = new RedisStore(redis);
  const logger = new UploadLoggerImpl(redisStore);
  const uploadManager = new UploadManager(logger);
  fastify.decorate('uploadManager', uploadManager);
}

export default fp(services, {
  name: 'services',
});
