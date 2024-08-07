import axios from 'axios';
import { spawn } from 'child_process'; 
import { Worker, Job, DelayedError, ConnectionOptions } from 'bullmq';
import { DateTime } from 'luxon';

import Auth from '../lib/authentication';

export interface MoveContactData {
  parentId: string;
  contactId: string;
  sessionToken: string;
  instanceUrl: string;
}

export type JobResult = { success: boolean; message: string };

export class MoveContactWorker {    
  private static readonly DELAY_IN_MILLIS = 4 * 60 * 60 * 1000;       // 4 hours
  private static readonly MAX_TIMEOUT_IN_MILLIS = 4 * 60 * 60 * 1000; // 4 hours
  private static readonly MAX_CONCURRENCY = 1;              // Limit concurrency to 1 job at a time
  private static readonly MAX_SENTINEL_BACKLOG = 7000;      // ensure we don't take down the server
  static worker: Worker;
  
  public static processQueue(queueName: string, connection: ConnectionOptions) {
    this.worker = new Worker(
      queueName, 
      this.handleJob, 
      { connection, concurrency: this.MAX_CONCURRENCY }
    );
  }

  public static async close() {
    const client = await this.worker?.client;
    if (client?.status !== 'end') {
      await this.worker?.close(true);
    }
  }

  private static handleJob = async (job: Job, processingToken?: string): Promise<boolean> => {
    const jobData: MoveContactData = job.data;

    // Ensure server availability
    if (await this.shouldPostpone(jobData)) {
      await this.postpone(job, processingToken);
      throw new DelayedError();
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

  private static async shouldPostpone(jobData: MoveContactData): Promise<boolean> {
    try {
      const { instanceUrl } = jobData;
      const response = await axios.get(`${instanceUrl}/api/v2/monitoring`);
      const sentinelBacklog = response.data.sentinel?.backlog;
      console.log(`Sentinel backlog at ${sentinelBacklog} of ${this.MAX_SENTINEL_BACKLOG}`);
      return sentinelBacklog > this.MAX_SENTINEL_BACKLOG;
    } catch (err: any) {
      const errorMessage = err.response?.data?.error?.message || err.response?.error || err?.message;
      console.error('Error fetching monitoring data:', errorMessage);
      return true;
    }
  }

  private static async moveContact(jobData: MoveContactData): Promise<JobResult> {
    try {
      const { contactId, parentId, instanceUrl, sessionToken } = jobData;

      if (!sessionToken) {
        return { success: false, message: 'Missing session token' };
      }

      const decodedToken = Auth.decodeTokenForWorker(sessionToken);
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

  private static buildCommandArgs(instanceUrl: string, sessionToken: string, contactId: string, parentId: string): string[] {
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

  private static logCommand(command: string, args: string[]): void {
    const maskedArgs = args.map(arg => arg.startsWith('--session-token=') ? '--session-token=********' : arg);
    console.log('Executing command:', `${command} ${maskedArgs.join(' ')}`);
  }

  private static async executeCommand(command: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const chtProcess = spawn(command, args);
      let lastOutput = '';

      const timeout = setTimeout(() => {
        chtProcess.kill();
        reject(new Error('cht-conf timed out'));
      }, this.MAX_TIMEOUT_IN_MILLIS);

      chtProcess.stdout.on('data', data => {
        console.log(`cht-conf: ${data}`);
        lastOutput = data.toString();
      });

      chtProcess.stderr.on('data', error => {
        console.error(`cht-conf error: ${error}`);
      });

      chtProcess.on('close', code => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve();
        }
        reject(new Error(`Move contact command exited with code ${code}. Last output: ${lastOutput}`));
      });

      chtProcess.on('error', error => {
        clearTimeout(timeout);
        console.log(error);
        reject(error);
      });
    });
  }

  private static async postpone(job: Job, processingToken?: string): Promise<void> {
    // Calculate the retry time using luxon
    const retryTime = DateTime.now().plus({ milliseconds: this.DELAY_IN_MILLIS });
    const retryTimeFormatted = retryTime.toLocaleString(DateTime.TIME_SIMPLE);
    
    // Delayed this job by DELAY_IN_MILLIS, using the current worker processing token
    await job.moveToDelayed(retryTime.toMillis(), processingToken);

    const retryMessage = `Job ${job.id} postponed until ${retryTimeFormatted}.  Reason was sentinel backlog.`;
    job.log(`[${new Date().toISOString()}]: ${retryMessage}`);
    console.log(retryMessage);
  }
}
