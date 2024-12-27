import Redis from 'ioredis';
import { env } from 'process';

const environment = env as unknown as { 
  REDIS_HOST: string; 
  REDIS_PORT: string; 
};

export const WorkerConfig = {
  redisConnection: {
    host: environment.REDIS_HOST,
    port: Number(environment.REDIS_PORT),
  },
  chtConfQueueName: 'MOVE_CONTACT_QUEUE',
  defaultJobOptions: {
    attempts: 3, // Max retries for a failed job
    backoff: {
      type: 'custom',
    },
  }
};

const assertRedisConfig = () => {
  const {host, port} = WorkerConfig.redisConnection;
  if (!host) {
    throw new Error('REDIS_HOST is not defined');
  }
  if (!port || isNaN(port) || port <= 0) {
    throw new Error('REDIS_PORT is not defined or invalid');
  }
};

export const checkRedisConnection = async () => {
  assertRedisConfig();

  const config = WorkerConfig.redisConnection;
  const redis = new Redis(config.port, config.host, {lazyConnect: true});
  try {
    await redis.connect();
  } catch (error : any) {
    throw new Error(`Failed to connect to Redis at ${config.host}:${config.port}: ${error}`);
  } finally {
    redis?.disconnect();
  }
};
