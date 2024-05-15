import { Job } from 'bullmq';
import { BullMQWorker } from '../../worker';
import { MoveContactJobProcessor } from './move-contact-job.processor';

export interface MoveContactParams {
  name: string;
  parentId: string;
  contactId: string;
  sessionCookie: string;
  instanceUrl: string;
}

export class MoveContactJobWorker extends BullMQWorker {

  constructor(queueName: string, processor = new MoveContactJobProcessor()) {
    super(queueName, processor);
  }

  async canProcess(job: Job): Promise<boolean> {

    const isReady = () => true;

    if (!isReady) {
      const delayInDays = 2;
      await this.postponeJob(job, delayInDays);
      return false;
    }

    return true;
  }

  private async postponeJob(job: Job, delayInDays: number): Promise<void> {
    const delay = delayInDays * 24 * 60 * 60 * 1000;

    await this.jobQueue.addJob(job.name, job.data, { backoff: { type: 'fixed', delay } });
    console.log(`Job postponed: ${job.id} (retry in ${delayInDays} days)`);
  }
}
