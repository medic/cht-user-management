import axios from 'axios';
import { spawn } from 'child_process'; 
import { Worker, Job } from 'bullmq';

import Auth from '../lib/authentication';
import { queuePrivateKey, redisConnection } from '../shared/queue-config';
import { queueManager } from '../shared/queues';

export interface MoveContactData {
  parentId: string;
  contactId: string;
  sessionToken: string;
  instanceUrl: string;
}

export type JobResult = { success: boolean; message: string };

export class MoveContactWorker {
  private readonly DELAY_IN_MILLIS = 360_000;   // 1 hour
  private readonly MAX_TIMEOUT = 180_000;       // 30 minutes timeout
  private readonly MAX_CONCURRENCY = 1;         // Limit concurrency to 1 job at a time
  private readonly MAX_SENTINEL_BACKLOG = 5000; // ensure we don't take down the server
  
  constructor(private queueName: string) {
    this.initializeWorker();
  }

  private initializeWorker() {
    return new Worker(
      this.queueName, 
      this.handleJob, 
      { connection: redisConnection, concurrency: this.MAX_CONCURRENCY }
    );
  }

  private handleJob = async (job: Job): Promise<boolean> => {
    const jobData: MoveContactData = job.data;

    // Ensure server availability
    if (!(await this.canProcess(jobData))) {
      await this.postpone(job);
      return true;
    }

    const result = await this.moveContact(jobData);
    if (!result.success) {
      job.log(`[${new Date().toISOString()}]: ${result.message}`);
      const errorMessage = `Job ${job.id} failed with the following error: ${result.message}`;
      console.error(errorMessage);
      throw new Error(errorMessage);
    }

    console.log(`Job completed successfully: ${job.id}`);
    return true;
  };

  private async canProcess(jobData: MoveContactData): Promise<boolean> {
    return true;
  }

  private async moveContact(jobData: MoveContactData): Promise<JobResult> {
    try {
      const { contactId, parentId, instanceUrl, sessionToken } = jobData;

      if (!sessionToken) {
        return { success: false, message: 'Missing session token' };
      } else if (!queuePrivateKey) {
        return { success: false, message: 'Missing QUEUE_PRIVATE_KEY' };
      }

      const decodedToken = Auth.decodeToken(sessionToken, queuePrivateKey);
      const token = decodedToken.sessionToken.replace('AuthSession=', '');

      const command = 'cht';
      const args = this.buildCommandArgs(instanceUrl, token, contactId, parentId);
      
      this.logCommand(command, args);
      await this.executeCommand(command, args);

      return { success: true, message: `Job processing completed.` };
    } catch (error) {
      return { success: false, message: error as string };
    }
  }

  private buildCommandArgs(instanceUrl: string, sessionToken: string, contactId: string, parentId: string): string[] {
    return [
      `--url=${instanceUrl}`,
      `--session-token=${sessionToken}`,
      '--force',
      'move-contacts',
      'upload-docs',
      '--',
      `--contacts=${contactId}`,
      `--parent=${parentId}`
    ];
  }

  private logCommand(command: string, args: string[]): void {
    const maskedArgs = args.map(arg => arg.startsWith('--session-token=') ? '--session-token=********' : arg);
    console.log('Executing command:', `${command} ${maskedArgs.join(' ')}`);
  }

  private async executeCommand(command: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const chtProcess = spawn(command, args);

      const timeout = setTimeout(() => {
        // chtProcess.kill();
        // reject(new Error('cht-conf timed out'));
      }, this.MAX_TIMEOUT);

      chtProcess.stdout.on('data', data => {
        console.log(`cht-conf: ${data}`);
      });

      chtProcess.stderr.on('data', error => {
        console.error(`cht-conf error: ${error}`);
      });

      chtProcess.on('close', code => {
        clearTimeout(timeout);
        code === 0 ? resolve() : reject(new Error(`cht-conf exited with code ${code}`));
      });

      chtProcess.on('error', error => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  private async postpone(job: Job): Promise<boolean> {
    // Add this job back to queue with a DELAY_IN_MILLIS delay
    const jobParams = {
      jobName: job.name,
      jobData: job.data,
      jobOpts: {
        ...job.opts,
        delay: this.DELAY_IN_MILLIS
      },
      queueName: this.queueName,
    };
    await queueManager.addJob(jobParams);

    const retryMessage = `Job postponed (not ready): ${job.id} (retry in ${this.DELAY_IN_MILLIS / 1000} sec.)`;
    job.log(`[${new Date().toISOString()}]: ${retryMessage}`);
    console.log(retryMessage);
    return true;
  }
}
