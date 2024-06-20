import { config } from 'dotenv';

config();

import { moveContactQueue } from '../lib/queues';
import { MoveContactWorker } from './move-contact-worker';

(() => {
  new MoveContactWorker(moveContactQueue.name);
  console.log(`🚀 Move Contact Worker is listening`);
})();
