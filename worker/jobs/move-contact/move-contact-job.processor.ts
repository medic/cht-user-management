import { JobProcessor, ProcessResult } from '../../worker';
import { MoveContactParams } from './move-contact.job';
const { spawn } = require('child_process'); // Use spawn for more control


export class MoveContactJobProcessor implements JobProcessor<MoveContactParams> {
  async process(jobData: MoveContactParams): Promise<ProcessResult> {
    const { contactId, parentId, instanceUrl, sessionCookie } = jobData;

    try {
      const chtProcess = spawn('cht', [
        `--url=${instanceUrl}`,
        `--session-token=${sessionCookie}`,
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
        chtProcess.on('close', (code: any) => {
          if (code === 0) {
            resolve(true);
          } else {
            reject(new Error(`Cht command exited with code ${code}`));
          }
        });

        chtProcess.on('error', (error: any) => {
          reject(error);
        });
      });

      return { success: true, message: `Job processing completed.` };
    } catch (error) {
      return { success: false, message: error };
    }
  }
}

