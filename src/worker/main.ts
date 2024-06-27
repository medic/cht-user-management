import { config } from 'dotenv';

config();

import { MoveContactWorker } from './move-contact-worker';
import { WorkerConfig, checkRedisConnection } from '../config/config-worker';

(async () => {
  const { moveContactQueue, redisConnection} = WorkerConfig;
  await checkRedisConnection();
  MoveContactWorker.processQueue(
    moveContactQueue, 
    redisConnection
  );
  console.log(`🚀 Move Contact Worker is listening`);
})();
