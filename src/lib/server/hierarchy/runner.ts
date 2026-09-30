import { randomUUID } from 'node:crypto';
import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

import type { Instance } from '../auth/instances';
import { baseUrl } from '../auth/instances';
import { readToken } from '../auth/tokens';
import type { Cht } from '../cht/client';
import { ChtError, ApiError } from '../errors';
import type { JobSettings } from '../settings';
import { ChtConfFailed, type ChtConfRunner } from './cht-conf';
import { runDelete } from './delete';
import { runRestore } from './restore';
import { runMove } from './move';
import { runMerge } from './merge';
import type { UploadLog } from '../upload-log';
import type { HierarchyJob, JobStore } from './jobs';

// Runs hierarchy jobs (APP.md → Running the job): one at a time per CHT instance, across every server
// instance, so a long job on one instance never holds up another.

export type RunnerDeps = {
  store: JobStore;
  settings: JobSettings;
  instances: Instance[];
  workerKey: string;
  chtFor: (instance: Instance, sessionCookie: string) => Cht;
  runChtConf: ChtConfRunner;
  // where restored logins' new passwords are kept, as for any new login
  uploadLog: UploadLog;
  now?: () => Date;
};

const LOCK_MS = 60_000;
const LOG_TAIL = 30;

export class JobRunner {
  private readonly owner = randomUUID();
  private timer: ReturnType<typeof setInterval> | undefined;
  private busy = false;
  private lastSweep = 0;

  constructor(private readonly deps: RunnerDeps) {}

  // current: whether this is still the runner to use; a replaced one stops at its next tick
  start(everyMs = 5000, current: () => boolean = () => true): void {
    this.timer ??= setInterval(() => {
      if (!current()) return this.stop();
      void this.tick().catch((e) => console.error('job runner', e));
    }, everyMs);
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  // One pass: for each instance with work whose lock this server gets, the next job that's due
  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.sweepArchives();
      for (const instanceId of await this.deps.store.instancesWithWork()) {
        if (!(await this.deps.store.lock(instanceId, this.owner, LOCK_MS))) continue;
        const heartbeat = setInterval(() => void this.deps.store.lock(instanceId, this.owner, LOCK_MS), LOCK_MS / 3);
        try {
          await this.runNext(instanceId);
        } finally {
          clearInterval(heartbeat);
          await this.deps.store.unlock(instanceId, this.owner);
        }
      }
    } finally {
      this.busy = false;
    }
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  // the first job in line that's due: queued, postponed until now, or running when its server stopped
  private async runNext(instanceId: string): Promise<void> {
    const due = (await this.deps.store.queue(instanceId)).find(
      (job) =>
        job.status === 'queued' ||
        job.status === 'running' ||
        (job.status === 'postponed' && Date.parse(job.postponed!.nextCheckAt) <= this.now().getTime())
    );
    if (!due) return;
    await this.run(due);
  }

  async run(job: HierarchyJob): Promise<HierarchyJob> {
    const { store, settings } = this.deps;
    const instance = this.deps.instances.find((i) => i.id === job.instanceId);
    const save = (change: Partial<HierarchyJob>) => {
      job = { ...job, ...change };
      return store.save(job);
    };
    const log = (line: string) => void store.appendLog(job.instanceId, job.id, [`${this.now().toISOString()} ${line}`]);
    if (!instance) {
      return save({
        status: 'failed',
        finishedAt: this.now().toISOString(),
        token: undefined,
        error: { message: `instance "${job.instanceId}" is no longer configured`, logTail: [] }
      });
    }

    // the user's own session, carried in the job token
    let sessionCookie: string;
    try {
      sessionCookie = (await readToken('job', job.token ?? '', this.deps.workerKey, this.now())).session.sessionCookie;
    } catch {
      log('The session this job carries has expired.');
      return save({ status: 'needs_sign_in', postponed: undefined });
    }
    const cht = this.deps.chtFor(instance, sessionCookie);

    // wait while the instance is busy processing changes, or down
    try {
      const backlog = await cht.sentinelBacklog();
      if (backlog > settings.maxSentinelBacklog) {
        log(`Sentinel has ${backlog} changes waiting (over ${settings.maxSentinelBacklog}); checking again later.`);
        return save({ status: 'postponed', postponed: { reason: 'sentinel_backlog', backlog, nextCheckAt: this.recheckAt() } });
      }
    } catch (e) {
      if (signedOut(e)) {
        log('CHT no longer accepts the session this job carries.');
        return save({ status: 'needs_sign_in', postponed: undefined });
      }
      log(`The instance can't be reached (${(e as Error).message}); checking again later.`);
      return save({ status: 'postponed', postponed: { reason: 'instance_down', nextCheckAt: this.recheckAt() } });
    }

    await save({
      status: 'running',
      postponed: undefined,
      error: undefined,
      attempts: job.attempts + 1,
      startedAt: this.now().toISOString()
    });
    log(`Started, attempt ${job.attempts}.`);
    try {
      if (job.kind === 'restore') {
        const source = await store.get(job.instanceId, job.request.sourceJobId);
        if (!source) throw new ApiError(404, 'JOB_NOT_FOUND', 'The delete this undoes is no longer kept.');
        const finished = await runRestore({
          job,
          source,
          cht,
          store,
          uploadLog: this.deps.uploadLog,
          instanceUrl: baseUrl(instance).replace(/\/$/, ''),
          sessionCookie,
          runChtConf: this.deps.runChtConf,
          workDir: settings.workDir,
          archiveDir: settings.archiveDir,
          log,
          update: save
        });
        log('Done.');
        return save({ ...finished, token: undefined });
      }
      if (job.kind === 'merge') {
        const finished = await runMerge({
          job,
          cht,
          instanceUrl: baseUrl(instance).replace(/\/$/, ''),
          sessionCookie,
          runChtConf: this.deps.runChtConf,
          workDir: settings.workDir,
          archiveDir: settings.archiveDir,
          archiveTtlSeconds: settings.archiveTtlSeconds,
          log,
          update: save
        });
        log('Done.');
        return save({ ...finished, token: undefined });
      }
      if (job.kind === 'move') {
        const finished = await runMove({
          job,
          cht,
          instanceUrl: baseUrl(instance).replace(/\/$/, ''),
          sessionCookie,
          runChtConf: this.deps.runChtConf,
          workDir: settings.workDir,
          log,
          update: save
        });
        log('Done.');
        return save({ ...finished, token: undefined });
      }
      if (job.kind !== 'delete') {
        throw new ApiError(422, 'NOT_YET_SUPPORTED', `${job.kind} jobs can't run yet`);
      }
      const finished = await runDelete({
        job,
        cht,
        instanceUrl: baseUrl(instance).replace(/\/$/, ''),
        sessionCookie,
        runChtConf: this.deps.runChtConf,
        workDir: settings.workDir,
        archiveDir: settings.archiveDir,
        archiveTtlSeconds: settings.archiveTtlSeconds,
        log,
        update: save
      });
      log('Done.');
      return save({ ...finished, token: undefined });
    } catch (e) {
      // cht-conf reports a rejected session only in its output
      const recent = (await store.log(job.instanceId, job.id)).slice(-LOG_TAIL).join('\n');
      if (signedOut(e) || (e instanceof ChtConfFailed && /\b401\b|unauthori[sz]ed|not logged in|AuthSession/i.test(recent))) {
        log('CHT stopped accepting the session partway; sign in again to resume. Re-running is safe.');
        return save({ status: 'needs_sign_in' });
      }
      const message = e instanceof Error ? e.message : String(e);
      log(`Failed: ${message}`);
      const logTail = (await store.log(job.instanceId, job.id)).slice(-LOG_TAIL);
      return save({ status: 'failed', finishedAt: this.now().toISOString(), error: { message, logTail } });
    }
  }

  private recheckAt(): string {
    return new Date(this.now().getTime() + this.deps.settings.recheckSeconds * 1000).toISOString();
  }

  // archives past ARCHIVE_TTL, checked at most hourly
  private async sweepArchives(): Promise<void> {
    if (Date.now() - this.lastSweep < 3_600_000) return;
    this.lastSweep = Date.now();
    const root = this.deps.settings.archiveDir;
    const cutoff = Date.now() - this.deps.settings.archiveTtlSeconds * 1000;
    for (const instance of await readdir(root).catch(() => [] as string[])) {
      for (const name of await readdir(join(root, instance)).catch(() => [] as string[])) {
        const path = join(root, instance, name);
        if ((await stat(path)).mtimeMs < cutoff) await rm(path, { force: true });
      }
    }
  }
}

function signedOut(e: unknown): boolean {
  return e instanceof ChtError && (e.status === 401 || (e.status === 400 && /AuthSession/i.test(e.message)));
}
