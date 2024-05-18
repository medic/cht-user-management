import { Job } from 'bullmq';
import { BullMQWorker } from '../../worker';
import { MoveContactJobProcessor } from './move-contact-job.processor';
import { queueManager } from '../../../shared/queues';

export interface MoveContactParams {
  name: string;
  parentId: string;
  contactId: string;
  sessionToken: string;
  instanceUrl: string;
}

export class MoveContactJobWorker extends BullMQWorker {
  
  DELAY_IN_DAYS = 3;

  constructor(queueName: string, processor = new MoveContactJobProcessor()) {
    super(queueName, processor);
  }

  async canProcess(job: Job): Promise<boolean> {
    // TODO: Implement logic here
    return !!job;
  }

  async postpone(job: Job): Promise<boolean> {
    const delay = this.DELAY_IN_DAYS * 24 * 60 * 60 * 1000;

    const jobParams = {
      jobName: job.name,
      jobData: job.data,
      jobOpts: {
        ...job.opts,
        delay
      },
      queueName: this.jobQueueName,
    };
    await queueManager.addJob(jobParams);
    console.log(`Job postponed: ${job.id} (retry in ${this.DELAY_IN_DAYS} days)`);
    return true;
  }
}
