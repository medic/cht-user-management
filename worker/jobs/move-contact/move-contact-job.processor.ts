import { env } from 'process'; 
import { spawn } from 'child_process'; 

import { JobProcessor, JobResult } from '../../worker';
import { MoveContactParams } from './move-contact-job.worker';
import { decryptSessionToken } from '../../../shared/encryption';


export class MoveContactJobProcessor implements JobProcessor<MoveContactParams> {

  readonly MAX_TIMEOUT = 180_000; // 30 minutes timeout?

  async process(jobData: MoveContactParams): Promise<JobResult> {
    try {
      const { contactId, parentId, instanceUrl, sessionToken } = jobData;
      const { ENCRYPTION_KEY } = env;

      if (!sessionToken) {
        return { success: false, message: 'Missing session token' };
      } else if (!ENCRYPTION_KEY) {
        return { success: false, message: 'Missing ENCRYPTION_KEY' };
      }

      const decryptedSessionToken = decryptSessionToken(
        sessionToken, ENCRYPTION_KEY
      );

      const chtProcess = spawn('cht', [
        `--url=${instanceUrl}`,
        `--session-token=${decryptedSessionToken}`,
        `--force`,
        'move-contacts',
        'upload-docs',
        '--',
        `--contacts=${contactId}`,
        `--parent=${parentId}`,
      ]);

      chtProcess.stdout.on('data', (data: any) => {
        console.log(`Cht command output:\n${data}`);
      });

      chtProcess.stderr.on('data', (data: any) => {
        console.error(`Cht command error:\n${data}`);
      });

      await new Promise((resolve, reject) => {
        // Worst cases: to ensure that child processes do not run indefinitely
        const timeout = setTimeout(() => {
          chtProcess.kill();
          reject(new Error('Cht command timed out'));
        }, this.MAX_TIMEOUT);

        chtProcess.on('close', (code: any) => {
          clearTimeout(timeout);
          if (code === 0) {
            resolve(true);
          } else {
            reject(new Error(`Cht command exited with code ${code}`));
          }
        });

        chtProcess.on('error', (error: any) => {
          clearTimeout(timeout);
          reject(error);
        });
      });

      return { success: true, message: `Job processing completed.` };
    } catch (error) {
      return { success: false, message: error as string };
    }
  }
}

