import { config } from 'dotenv';

config();

import { ChtConfWorker } from './cht-conf-worker';
import { WorkerConfig, checkRedisConnection } from '../config/config-worker';

(async () => {
  const { chtConfQueueName, redisConnection } = WorkerConfig;
  await checkRedisConnection();
  ChtConfWorker.processQueue(
    chtConfQueueName, 
    redisConnection
  );
  console.log(`🚀 CHT Conf Worker is listening`);
})();
