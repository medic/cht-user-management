import { config } from 'dotenv';

config();

import { ChtConfWorker } from './cht-conf-worker';
import { WorkerConfig, checkRedisConnection } from '../config/config-worker';

(async () => {
  const { moveContactQueue, redisConnection} = WorkerConfig;
  await checkRedisConnection();
  ChtConfWorker.processQueue(
    moveContactQueue, 
    redisConnection
  );
  console.log(`🚀 Move Contact Worker is listening`);
})();
