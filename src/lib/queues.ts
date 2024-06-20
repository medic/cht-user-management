import { v4 } from 'uuid';
import { env } from 'process';
import { JobsOptions, Queue, ConnectionOptions } from 'bullmq';

const MOVE_CONTACT_QUEUE = 'MOVE_CONTACT_QUEUE';

const environment = env as unknown as { 
  REDIS_HOST: string; 
  REDIS_PORT: string; 
  QUEUE_PRIVATE_KEY: string;
};

export const QUEUE_PRIVATE_KEY = environment.QUEUE_PRIVATE_KEY;

export const redisConnection: ConnectionOptions = {
  host: environment.REDIS_HOST,
  port: Number(environment.REDIS_PORT)
};

export interface IQueue {
  name: string;
  add(jobParams: any): Promise<string>;
}

export interface JobParams {
  jobName: string;
  jobData: any;
  jobOpts?: JobsOptions;
}

export class BullQueue implements IQueue {
  public readonly name: string;
  public readonly bullQueue: Queue;

  constructor(queueName: string) {
    this.name = queueName;
    this.bullQueue = new Queue(queueName, { connection: redisConnection });
  }

  public async add(jobParams: JobParams): Promise<string> {
    const jobId = v4();
    const { jobName, jobData, jobOpts } = jobParams;

    await this.bullQueue.add(jobName, jobData, { jobId, ...jobOpts });
    return jobId;
  }
}

// Create a singleton instance of QueueManager
export const moveContactQueue = new BullQueue(MOVE_CONTACT_QUEUE);
