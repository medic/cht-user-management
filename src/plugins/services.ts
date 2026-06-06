import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { UploadManager } from '../services/upload-manager';
import { RedisStore, UploadLoggerImpl } from '../services/upload-log';
import { checkRedisConnection } from '../config/config-worker';
import AuthTokenManager from '../services/auth-token-manager';
import { Config } from '../config';

async function services(fastify: FastifyInstance) {
  const redis = await checkRedisConnection();
  const redisStore = new RedisStore(redis);
  const logger = new UploadLoggerImpl(redisStore);
  const uploadManager = new UploadManager(logger);
  const authTokenManager = new AuthTokenManager(Config.getExternalSources());
  fastify.decorate('uploadManager', uploadManager);
  fastify.decorate('authTokenManager', authTokenManager);
}

export default fp(services, {
  name: 'services',
});


