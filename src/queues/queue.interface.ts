export interface IQueue {
  add(jobName: string, data: unknown): Promise<void>;
}
