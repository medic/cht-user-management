import { env } from 'process';
import { config } from 'dotenv';

import Fastify from 'fastify';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { createBullBoard } from '@bull-board/api';
import { FastifyAdapter } from '@bull-board/fastify';
import { Queue } from 'bullmq';
import { MoveContactJobWorker } from './jobs/move-contact/move-contact.job';

config();


interface WorkerConfig {
  queueName: string;
  workerClass: new (queueName: string) => any;
}

const getQueueName = (envVarName: string): string => {
  const value = env[envVarName];
  if (!value) {
    console.error(`Missing required environment variable: ${envVarName}`);
    process.exit(1);
  }
  return value;
};

// Define the configuration for workers
const workerConfigs: WorkerConfig[] = [
  {
    queueName: getQueueName('MOVE_CONTACT_QUEUE'),
    workerClass: MoveContactJobWorker
  },
  // Add new workers here
];


async function main() {
  // Fastify app setup
  const app = Fastify({
    logger: {
      transport: {
        target: 'pino-pretty',
      },
    },
  });
  const serverAdapter = new FastifyAdapter();

  const port: number = env.BOARD_PORT ? +env.BOARD_PORT : 7878;

  // Initialize queues and BullBoard adapters
  const queues: Queue[] = [];
  for (const { queueName, workerClass } of workerConfigs) {
    try {
      const worker = new workerClass(queueName);
      queues.push(worker.jobQueue.getQueue());
    } catch (error) {
      console.error(`Error starting worker for queue "${queueName}":`, error);
      throw error;
    }
  }

  createBullBoard({
    queues: queues.map(q => new BullMQAdapter(q)),
    serverAdapter
  });

  // Configure Fastify server for BullBoard
  serverAdapter.setBasePath('/board');
  app.register(serverAdapter.registerPlugin(), { prefix: '/board', basePath: '/board' });

  // Start the server
  app.listen({ host: '0.0.0.0', port }, () => {
    console.log(`Board is accessible on  port ${port}`);
  });
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
