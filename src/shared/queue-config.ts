import { ConnectionOptions } from 'bullmq';
import { env } from 'process';

const environment = env as unknown as { REDIS_HOST: string; REDIS_PORT: string; QUEUE_PRIVATE_KEY: string };
export const redisConnection: ConnectionOptions = {
  host: environment.REDIS_HOST,
  port: Number(environment.REDIS_PORT)
};

export const QUEUE_PRIVATE_KEY = environment.QUEUE_PRIVATE_KEY;
