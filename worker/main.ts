import { config } from 'dotenv';

import { MoveContactJobWorker } from './jobs/move-contact/move-contact-job.worker';
import { QUEUE_NAMES } from '../shared/queues';

config();

interface WorkerConfig {
  queueName: string;
  workerClass: new (queueName: string) => any;
}

// Define the configuration for workers
const workerConfigs: WorkerConfig[] = [
  {
    queueName: QUEUE_NAMES.MOVE_CONTACT_QUEUE,
    workerClass: MoveContactJobWorker
  },
  // Add new workers here
];


async function main() {
  for (const { queueName, workerClass } of workerConfigs) {
    try {
      new workerClass(queueName);
    } catch (error) {
      console.error(`Error starting worker for queue "${queueName}":`, error);
      throw error;
    }
  }

  console.log(`🚀 All your workers are listening`);
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
