import { JobsOptions, Queue } from 'bullmq';
import { redisConnection } from './config';

export interface JobQueue<T> {
  addJob(name: string, data: any, options?: any): Promise<void>;
  removeJob(id: string): Promise<void>;
  getName(): string;
  getQueue(): T;
}

export class BullMQQueue implements JobQueue<Queue> {
  private readonly queue: Queue;

  constructor(private readonly queueName: string) {
    this.queue = new Queue(this.queueName, { connection: redisConnection });
  }

  async addJob(name: string, data: any, options?: JobsOptions): Promise<void> {
    await this.queue.add(name, data, options);
  }

  async removeJob(id: string): Promise<void> {
    await this.queue.remove(id);
  }

  getName(): string {
    return this.queueName;
  }

  getQueue(): Queue {
    return this.queue;
  }
}
