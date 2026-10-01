import { Redis } from 'ioredis';

import { RedisRevocationList, type RevocationList } from './auth/revocation';
import { HttpCht } from './cht/client';
import { processRunner } from './hierarchy/cht-conf';
import { RedisJobStore, type JobStore } from './hierarchy/jobs';
import { JobRunner } from './hierarchy/runner';
import { getSettings } from './settings';
import { RedisStagedStore, type StagedStore } from './staged/store';
import { RedisUploadTracker, type UploadTracker } from './staged/upload-tracker';
import { RedisUploadLog, type UploadLog } from './upload-log';

// Process-wide services, created on first use from the settings. Redis is the only datastore
// (APP.md → Data storage), shared by every server instance.
let redis: Redis | undefined;
let revocations: RevocationList | undefined;
let uploadLog: RedisUploadLog | undefined;
let stagedStore: RedisStagedStore | undefined;
let uploadTracker: UploadTracker | undefined;
let validationTracker: UploadTracker | undefined;

export function getRedis(): Redis {
  redis ??= new Redis(getSettings().redisUrl, { maxRetriesPerRequest: 2 });
  return redis;
}

export function getRevocations(): RevocationList {
  revocations ??= new RedisRevocationList(getRedis());
  return revocations;
}

export function getUploadLog(): UploadLog {
  const settings = getSettings();
  uploadLog ??= new RedisUploadLog(getRedis(), settings.secretKey, settings.dataTtlSeconds);
  return uploadLog;
}

export function getStagedStore(): StagedStore {
  const settings = getSettings();
  stagedStore ??= new RedisStagedStore(getRedis(), settings.secretKey);
  return stagedStore;
}

export function getUploadTracker(): UploadTracker {
  uploadTracker ??= new RedisUploadTracker(getRedis());
  return uploadTracker;
}

let jobStore: JobStore | undefined;
let jobRunner: JobRunner | undefined;

export function getJobStore(): JobStore {
  const settings = getSettings();
  jobStore ??= new RedisJobStore(getRedis(), settings.secretKey, settings.dataTtlSeconds);
  return jobStore;
}

// Runs hierarchy jobs in the background of every server; the store's per-instance lock keeps it to
// one job at a time per CHT instance. One runner per process: a new one (eg. after the dev server
// reloads this module) stops the one before, which would otherwise keep running the old code.
const RUNNER = Symbol.for('cht-iam.jobRunner');
type WithRunner = typeof globalThis & { [RUNNER]?: JobRunner };

export function startJobRunner(): JobRunner {
  const settings = getSettings();
  const global = globalThis as WithRunner;
  if (jobRunner && global[RUNNER] === jobRunner) {
    return jobRunner;
  }
  global[RUNNER]?.stop();
  jobRunner = new JobRunner({
    store: getJobStore(),
    settings: settings.jobs,
    instances: settings.instances,
    workerKey: settings.workerKey,
    chtFor: (instance, sessionCookie) => new HttpCht({ domain: instance.host, useHttp: instance.useHttp, sessionCookie }),
    runChtConf: processRunner({ timeoutSeconds: settings.jobs.timeoutSeconds, heapMb: settings.jobs.chtConfHeapMb }),
    uploadLog: getUploadLog()
  });
  global[RUNNER] = jobRunner;
  jobRunner.start(5000, () => global[RUNNER] === jobRunner);
  return jobRunner;
}

export function getValidationTracker(): UploadTracker {
  validationTracker ??= new RedisUploadTracker(getRedis(), 'validation');
  return validationTracker;
}

// Removes staged items and passwords past DATA_RETENTION_TTL every few minutes, so nothing that
// succeeded is kept longer just because no one read it (jobs and their logs expire in Redis on their
// own, and the job runner sweeps their archives). Safe on every server at once: removals are idempotent
const SWEEPER = Symbol.for('cht-iam.dataSweeper');
type WithSweeper = typeof globalThis & { [SWEEPER]?: ReturnType<typeof setInterval> };
const SWEEP_MS = 10 * 60 * 1000;

export function startDataSweeper(): void {
  const global = globalThis as WithSweeper;
  clearInterval(global[SWEEPER]);
  const sweep = async () => {
    try {
      // loaded here: the staged service reaches this module through http.ts
      const { expired, forgetItemJob } = await import('./staged/service');
      const settings = getSettings();
      const deps = {
        ttlSeconds: settings.dataTtlSeconds,
        jobs: { store: getJobStore(), workerKey: settings.workerKey, settings: settings.jobs }
      };
      await (getStagedStore() as RedisStagedStore).sweep(async (owner, item) => {
        if (!(await expired(deps, owner, item))) return false;
        await forgetItemJob(deps, owner, item);
        return true;
      });
      await (getUploadLog() as RedisUploadLog).sweep();
    } catch (e) {
      console.error('data sweep', e);
    }
  };
  void sweep();
  global[SWEEPER] = setInterval(sweep, SWEEP_MS);
}
