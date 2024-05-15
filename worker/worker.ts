import { redisConnection } from './config';
import { MoveContactParams } from './jobs/move-contact/move-contact.job';
import { BullMQQueue } from './queue';
import { Worker, Job } from 'bullmq';

export interface JobWorker {
  canProcess(job: any): Promise<boolean>;
  stop(): Promise<void>;
}

export type ProcessResult = { success: boolean; message: string };

export interface JobProcessor<T> {
  process(params: T): Promise<ProcessResult>;
}

export abstract class BullMQWorker implements JobWorker {
  readonly jobQueue: BullMQQueue;
  private readonly processor: JobProcessor<MoveContactParams>;
  private worker: Worker;

  constructor(queueName: string, processor: JobProcessor<MoveContactParams>) {
    this.jobQueue = new BullMQQueue(queueName);
    this.processor = processor;
    this.worker = new Worker(this.jobQueue.getName(), async (job: Job) => {
      if (!await this.canProcess(job)) {
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
    }, { connection: redisConnection });
  }

  async stop(): Promise<void> {
    await this.worker.close();
  }

  abstract canProcess(job: Job): Promise<boolean>;
}
