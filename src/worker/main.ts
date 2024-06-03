import { MOVE_CONTACT_QUEUE } from '../shared/queues';
import { MoveContactWorker } from './move-contact-worker';

(async () => {
  new MoveContactWorker(MOVE_CONTACT_QUEUE);
  console.log(`🚀 Move Contact Worker is listening`);
})();
