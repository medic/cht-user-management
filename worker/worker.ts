import { Worker, Job } from 'bullmq';
import { redisConnection } from '../shared/config';

export interface JobWorker {
  canProcess(job: any): Promise<boolean>;
  postpone(job: any): Promise<boolean>;
  stop(): Promise<void>;
}

export interface JobProcessor<T> {
  process(params: T): Promise<JobResult>;
}

export type JobResult = { success: boolean; message: string };


export abstract class BullMQWorker implements JobWorker {
  readonly MAX_CONCURRENCY = 1; // Limit concurrency to 1 job at a time

  readonly jobQueueName;
  private worker: Worker;

  constructor(queueName: string, private processor: JobProcessor<any>) {
    this.processor = processor;
    this.jobQueueName = queueName;
    this.worker = new Worker(this.jobQueueName, async (job: Job) => {
      if (!await this.canProcess(job)) {
        await this.postpone(job);
        console.log(`Job skipped (not ready): ${job.id}`);
        return;
      }

      const result = await this.processor.process(job.data);
      if (!result.success) {
        console.log(`Job ${job.id} failed with message: ${result.message}`);
        job.log(result.message);
        throw new Error();
      }

      console.log(`Job completed successfully: ${job.id}`);
      return true;
    }, { connection: redisConnection, concurrency: this.MAX_CONCURRENCY });
  }

  async stop(): Promise<void> {
    await this.worker.close();
  }

  abstract canProcess(job: Job): Promise<boolean>;

  abstract postpone(job: Job): Promise<boolean>;
}
