import axios from 'axios';
import { spawn } from 'child_process'; 
import { Worker, Job, DelayedError, ConnectionOptions, MinimalJob } from 'bullmq';
import { DateTime } from 'luxon';

import Auth from '../lib/authentication';
import { HierarchyAction } from '../lib/manage-hierarchy';

export interface ChtConfJobData {
  sourceId: string;
  destinationId: string;
  action: HierarchyAction;
  sessionToken: string;
  instanceUrl: string;
}

export interface PostponeReason {
  reason: string;
}

export type JobResult = { success: boolean; message: string };

export class ChtConfWorker {    
  private static readonly DELAY_IN_MILLIS = 4 * 60 * 60 * 1000;       // 4 hours
  private static readonly MAX_TIMEOUT_IN_MILLIS = 4 * 60 * 60 * 1000; // 4 hours
  private static readonly MAX_CONCURRENCY = 1;              // Limit concurrency to 1 job at a time
  private static readonly MAX_SENTINEL_BACKLOG = 7000;      // ensure we don't take down the server
  static worker: Worker;
  
  public static processQueue(queueName: string, connection: ConnectionOptions) {
    this.worker = new Worker(
      queueName, 
      this.handleJob, 
      { 
        connection, 
        concurrency: this.MAX_CONCURRENCY, 
        settings: {
          backoffStrategy: this.handleRetryBackoff,
        }
      }
    );
  }

  public static async close() {
    const client = await this.worker?.client;
    if (client?.status !== 'end') {
      await this.worker?.close(true);
    }
  }

  private static handleJob = async (job: Job, processingToken?: string): Promise<boolean> => {
    const jobData: ChtConfJobData = job.data;

    // Ensure server availability
    const postponseReason = await this.shouldPostpone(jobData);
    if (postponseReason) {
      await this.postpone(job, postponseReason.reason, processingToken);
      throw new DelayedError();
    }

    const result = await this.processChtConfJob(job);
    if (!result.success) {
      const errorMessage = `Job ${job.id} failed with the following error: ${result.message}`;
      console.error(errorMessage);
      this.logWithTimestamp(job, errorMessage);
      throw new Error(errorMessage);
    }

    console.log(`Job completed successfully: ${job.id}`);
    return true;
  };

  private static handleRetryBackoff = (
    attemptsMade: number, type: string | undefined, err: Error | undefined, job: MinimalJob | undefined
  ): number => {
    const {retryTimeFormatted} = this.computeRetryTime();

    const fullMessage = `Job ${job?.id} will retry at ${retryTimeFormatted}.\
    Attempt Number: ${attemptsMade + 1}. Due to failure: ${type}: ${err?.message}`;

    this.logWithTimestamp(job, fullMessage);
    return this.DELAY_IN_MILLIS;
  };

  private static async shouldPostpone(jobData: ChtConfJobData): Promise<PostponeReason | undefined> {
    try {
      const { instanceUrl } = jobData;
      const response = await ChtConfWorker.fetchMonitoringApi(instanceUrl);
      const sentinelBacklog = response.data.sentinel?.backlog;
      console.log(`Sentinel backlog at ${sentinelBacklog} of ${this.MAX_SENTINEL_BACKLOG}`);
      
      return sentinelBacklog > this.MAX_SENTINEL_BACKLOG 
        ? { reason: `Sentinel backlog too high at ${sentinelBacklog}` }
        : undefined;
    } catch (err: any) {
      const errorMessage = err.response?.data?.error?.message || err.response?.error || err?.message;
      console.error('Error fetching monitoring data:', errorMessage);

      // Handle server unavailability (HTTP 500 errors)
      if (err.response?.status === 500) {
        console.log('Server error encountered, postponing job...');
        return { reason: `Server error encountered: ${errorMessage}` };
      }
      return undefined;
    }
  }

  private static fetchMonitoringApi(instanceUrl: string) {
    return axios.get(`${instanceUrl}/api/v2/monitoring`);
  }

  private static async processChtConfJob(job: Job): Promise<JobResult> {
    try {
      const jobData: ChtConfJobData = job.data;

      if (!jobData.sessionToken) {
        return { success: false, message: 'Missing session token' };
      }

      const decodedToken = Auth.createWorkerSession(jobData.sessionToken);
      const token = decodedToken.sessionToken.replace('AuthSession=', '');

      const command = 'cht';
      const args = this.buildCommandArgs(jobData, token);
      
      this.logCommand(command, args);
      await this.executeCommand(command, args, job);

      return { success: true, message: `Job processing completed.` };
    } catch (error) {
      return { success: false, message: error as string };
    }
  }

  private static buildCommandArgs(data: ChtConfJobData, decodedToken: string): string[] {
    return [
      `--url=${data.instanceUrl}`,
      `--session-token=${decodedToken}`,
      '--force',
      getConfActionName(),
      'upload-docs',
      '--',
      ...getActionArgs(),
    ];

    function getConfActionName() {
      switch (data.action) {
      case 'delete':
        return 'delete-contacts';
      case 'merge':
        return 'merge-contacts';
      default:
        return 'move-contacts';
      }
    }

    function getActionArgs() {
      switch (data.action) {
      case 'delete':
        return [`--contacts=${data.sourceId}`, '--disable-users'];
      case 'merge':
        return [`--sources=${data.sourceId}`, `--destination=${data.destinationId}`, '--merge-primary-contacts', '--disable-users'];
      default:
        return [`--contacts=${data.sourceId}`, `--parent=${data.destinationId}`];
      }
    }
  }

  private static logCommand(command: string, args: string[]): void {
    const maskedArgs = args.map(arg => arg.startsWith('--session-token=') ? '--session-token=********' : arg);
    console.log('Executing command:', `${command} ${maskedArgs.join(' ')}`);
  }

  private static async executeCommand(command: string, args: string[], job: Job): Promise<void> {
    return new Promise((resolve, reject) => {
      const chtProcess = spawn(command, args);
      let lastOutput = '';

      const timeout = setTimeout(() => {
        chtProcess.kill();
        reject(new Error('cht-conf timed out'));
      }, this.MAX_TIMEOUT_IN_MILLIS);

      chtProcess.stdout.on('data', data => {
        lastOutput = data.toString();
        this.logWithTimestamp(job, `cht-conf output: ${data.toString()}`);
      });

      chtProcess.stderr.on('data', error => {
        lastOutput = error.toString();
        this.logWithTimestamp(job, `cht-conf error: ${error.toString()}`);
      });

      chtProcess.on('close', code => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve();
        }
        reject(new Error(`CHT command exited with code ${code}. Last output: ${lastOutput}`));
      });

      chtProcess.on('error', error => {
        clearTimeout(timeout);
        this.logWithTimestamp(job, `cht-conf process error: ${error.toString()}`);
        reject(error);
      });
    });
  }

  private static async postpone(job: Job, retryMessage: string, processingToken?: string): Promise<void> {
    const { retryTimeFormatted, retryTime } = this.computeRetryTime();
    this.logWithTimestamp(job, `Job ${job.id} postponed until ${retryTimeFormatted}. Reason: ${retryMessage}.`);
    await job.moveToDelayed(retryTime.toMillis(), processingToken);
  }

  private static computeRetryTime(): { retryTime: DateTime; retryTimeFormatted: string } {
    const retryTime = DateTime.now().plus({ milliseconds: this.DELAY_IN_MILLIS });
    const retryTimeFormatted = retryTime.toLocaleString(DateTime.TIME_SIMPLE);
    return { retryTime, retryTimeFormatted };
  }

  private static logWithTimestamp(job: Job|MinimalJob|undefined, message: string): void {
    const timestamp = DateTime.now().toISO();
    const fullMessage = `[${timestamp}] ${message}`;
    job?.log(fullMessage);
    console.log(fullMessage);
  }
}
