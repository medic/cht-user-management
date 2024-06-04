import { config } from 'dotenv';

config();

import { queueManager } from '../shared/queues';
import { MoveContactWorker } from './move-contact-worker';

(async () => {
  new MoveContactWorker(queueManager.getQueue().name);
  console.log(`🚀 Move Contact Worker is listening`);
})();
