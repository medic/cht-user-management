import { IQueue } from './queue.interface';
import { Queue as BullMQQueue } from 'bullmq';

export class BullMQ implements IQueue {
  private readonly queue: BullMQQueue;

  constructor(queueName: string, options?: any) {
    this.queue = new BullMQQueue(queueName, options);
  }

  async add(jobName: string, data: any): Promise<void> {
    await this.queue.add(jobName, data);
  }
}
