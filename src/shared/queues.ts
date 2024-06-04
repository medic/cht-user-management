import { v4 } from 'uuid';
import { JobsOptions, Queue } from 'bullmq';
import { redisConnection } from './queue-config';

const MOVE_CONTACT_QUEUE = 'MOVE_CONTACT_QUEUE';

export interface IQueueManager {
  addJob(jobParams: any): Promise<string>;
  getQueue(queueName: string): any;
}

export type JobParams = {
  jobName: string;
  jobData: any;
  jobOpts?: JobsOptions;
};

export class BullMQQueueManager implements IQueueManager {
  private queues: Map<string, Queue>;

  constructor() {
    this.queues = new Map();
  }
 
  public async addJob(jobParams: JobParams): Promise<string> {
    const jobId = v4();
    const { jobName, jobData, jobOpts} = jobParams;

    const queue = this.getQueue();
    await queue.add(jobName, jobData, { jobId, ...jobOpts });
    return jobId;
  }

  public getQueue(): Queue {
    return this.getOrCreateQueue(MOVE_CONTACT_QUEUE);
  }

  private getOrCreateQueue(queueName: string): Queue {
    if (!this.queues.has(queueName)) {
      this.queues.set(
        queueName, 
        new Queue(queueName, { connection: redisConnection })
      );
    }
    return this.queues.get(queueName)!;
  }
}

// BullMQQueueManager singleton instance
export const queueManager = new BullMQQueueManager();
