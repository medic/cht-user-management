import { config } from 'dotenv';
import { ConnectionOptions } from 'bullmq';
import { env } from 'process';

config();

const { REDIS_HOST, REDIS_PORT } = env;
export const redisConnection: ConnectionOptions = {
  host: REDIS_HOST as string,
  port: +(REDIS_PORT as string)
};

