import { v4 } from 'uuid';
import { Queue } from 'bullmq';
import { redisConnection } from '../config'; // Adjust the import based on your structure

export const QUEUE_NAMES = {
  MOVE_CONTACT_QUEUE: 'MOVE_CONTACT_QUEUE',
  // Lets add more queue names as need
};


export interface IQueueManager {
  addJob(jobParams: any): Promise<string>;
  removeJob(queueName: string, jobId: string): Promise<void>;
  getQueue(queueName: string): any;
}


export type JobParams = {
  queueName: string;
  jobName: string;
  jobData: any;
  jobOpts?: any;
};

export class BullMQQueueManager implements IQueueManager {
  private queues: Map<string, Queue>;

  constructor() {
    this.queues = new Map();
  }

  private getOrCreateQueue(queueName: string): Queue {
    console.log(this.queues, redisConnection);
    if (!this.queues.has(queueName)) {
      this.queues.set(
        queueName, 
        new Queue(queueName, { connection: redisConnection })
      );
    }
    return this.queues.get(queueName)!;
  }

  async addJob(jobParams: JobParams): Promise<string> {
    const jobId = v4();
    const { queueName, jobName, jobData, jobOpts} = jobParams;

    console.log(`adding new job to ${queueName} with ${jobData}`);

    const queue = this.getOrCreateQueue(queueName);
    await queue.add(jobName, jobData, { jobId, ...jobOpts });
    return jobId;
  }

  async removeJob(queueName: string, jobId: string): Promise<void> {
    const queue = this.getOrCreateQueue(queueName);
    await queue.remove(jobId);
  }

  getQueue(queueName: string): Queue {
    return this.getOrCreateQueue(queueName);
  }
}

// BullMQQueueManager singleton instance
export const queueManager = new BullMQQueueManager();
