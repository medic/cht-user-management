import { config } from 'dotenv';

config();

import { ChtConfWorker } from './cht-conf-worker';
import { WorkerConfig, checkRedisConnection } from '../config/config-worker';

(async () => {
  const { queueName, redisConnection} = WorkerConfig;
  await checkRedisConnection();
  ChtConfWorker.processQueue(
    queueName, 
    redisConnection
  );
  console.log(`🚀 CHT Conf Worker is listening`);
})();
