import { v4 } from 'uuid';
import { JobsOptions, Queue, ConnectionOptions, DefaultJobOptions } from 'bullmq';
import { WorkerConfig } from '../config/config-worker';

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

  constructor(queueName: string, connection: ConnectionOptions, defaultJobOptions?: DefaultJobOptions) {
    this.name = queueName;
    this.bullQueue = new Queue(queueName, { connection, defaultJobOptions });
  }

  public async add(jobParams: JobParams): Promise<string> {
    const jobId = v4();
    const { jobName, jobData, jobOpts } = jobParams;

    await this.bullQueue.add(jobName, jobData, { jobId, ...jobOpts });
    return jobId;
  }

  public async close(): Promise<void> {
    await this.bullQueue.close();
  }
}

export const getChtConfQueue = () => new BullQueue(
  WorkerConfig.queueName, 
  WorkerConfig.redisConnection,
  WorkerConfig.defaultJobOptions
);
