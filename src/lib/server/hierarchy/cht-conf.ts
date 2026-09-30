import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

// Runs one cht-conf action for a job (APP.md → Running the job): the hierarchy operations are
// cht-conf's own, the same code CHT's tooling uses. Each action is a separate process, in the job's
// working folder, with the session on standard input rather than the command line.

export type ChtConfAction = 'delete-contacts' | 'move-contacts' | 'merge-contacts' | 'upload-docs';

export type ChtConfRun = {
  action: ChtConfAction;
  // cht-conf's arguments after `--`, eg. ["--contacts=abc", "--disable-users"]
  args: string[];
  workDir: string;
  // the instance's origin, eg. https://echis.example.org
  instanceUrl: string;
  // the value of the CouchDB AuthSession cookie
  sessionToken: string;
  onLine: (line: string) => void;
};

export type ChtConfRunner = (run: ChtConfRun) => Promise<void>;

const SCRIPT = resolve('scripts/cht-conf-job.cjs');
// cht-conf's colours and progress bar redraws, which start with the escape character
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

export function processRunner(limits: { timeoutSeconds: number; heapMb: number }): ChtConfRunner {
  return (run) =>
    new Promise((done, fail) => {
      const child = spawn(process.execPath, [`--max-old-space-size=${limits.heapMb}`, SCRIPT], {
        cwd: run.workDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        // nothing of the server's own environment, which holds its secrets
        env: { PATH: process.env.PATH ?? '', NODE_ENV: 'production' }
      });
      const timer = setTimeout(() => child.kill('SIGKILL'), limits.timeoutSeconds * 1000);
      const lines = (chunk: Buffer) => {
        for (const line of chunk
          .toString('utf8')
          .replace(ANSI, '')
          .split(/[\r\n]+/)) {
          if (line.trim()) run.onLine(line.trimEnd());
        }
      };
      child.stdout.on('data', lines);
      child.stderr.on('data', lines);
      child.on('error', (e) => {
        clearTimeout(timer);
        fail(e);
      });
      child.on('close', (code, signal) => {
        clearTimeout(timer);
        if (code === 0) done();
        else
          fail(
            new ChtConfFailed(
              run.action,
              signal === 'SIGKILL' ? `took longer than ${limits.timeoutSeconds}s and was stopped` : `exited with ${code}`
            )
          );
      });
      child.stdin.end(
        JSON.stringify({ action: run.action, args: run.args, apiUrl: `${run.instanceUrl}/medic`, sessionToken: run.sessionToken })
      );
    });
}

export class ChtConfFailed extends Error {
  constructor(
    readonly action: ChtConfAction,
    detail: string
  ) {
    super(`cht-conf ${action} ${detail}`);
    this.name = 'ChtConfFailed';
  }
}

// "AuthSession=abc…" → "abc…"
export function authSessionValue(cookie: string): string {
  return cookie.replace(/^AuthSession=/, '').split(';')[0];
}
