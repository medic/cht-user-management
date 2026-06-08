import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { UploadManager } from '../services/upload-manager';
import { RedisStore, UploadLoggerImpl } from '../services/upload-log';
import { checkRedisConnection } from '../config/config-worker';
import ExternalSourceAuthManager from '../services/external-source-auth-manager';
import { Config } from '../config';

async function services(fastify: FastifyInstance) {
  const redis = await checkRedisConnection();
  const redisStore = new RedisStore(redis);
  const logger = new UploadLoggerImpl(redisStore);
  const uploadManager = new UploadManager(logger);
  const externalSourceAuthManager = new ExternalSourceAuthManager(Config.getExternalSources());
  fastify.decorate('uploadManager', uploadManager);
  fastify.decorate('externalSourceAuthManager', externalSourceAuthManager);
}

export default fp(services, {
  name: 'services',
});


