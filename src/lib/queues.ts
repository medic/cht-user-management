import { v4 } from 'uuid';
import { JobsOptions, Queue, ConnectionOptions, DefaultJobOptions } from 'bullmq';
import { WorkerConfig } from '../config/config-worker';

export type CancelResult = 'cancelled' | 'not_found' | 'locked';

export interface IQueue {
  name: string;
  add(jobParams: any): Promise<string>;
  cancel(jobId: string): Promise<CancelResult>;
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

  public async cancel(jobId: string): Promise<CancelResult> {
    const job = await this.bullQueue.getJob(jobId);
    if (!job) {
      return 'not_found';
    }
    try {
      await job.remove();
      return 'cancelled';
    } catch (e: any) {
      // BullMQ throws "Job <id> is locked" when a worker has already picked
      // up the job and removal is no longer safe.
      if (/locked/i.test(e?.message ?? '')) {
        return 'locked';
      }
      throw e;
    }
  }

  public async close(): Promise<void> {
    await this.bullQueue.close();
  }
}

export const getChtConfQueue = () => new BullQueue(
  WorkerConfig.chtConfQueueName, 
  WorkerConfig.redisConnection,
  WorkerConfig.defaultJobOptions
);
