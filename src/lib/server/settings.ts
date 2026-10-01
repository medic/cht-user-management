import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env } from '$env/dynamic/private';

import { instancesFileSchema, type Instance } from './auth/instances';
import { DEPLOYMENT_FILES } from './config';
import { DEFAULT_MAX_PLACES_LOADED } from './places/lookup';

export type Settings = {
  production: boolean;
  // DEPLOYMENT_DIR: the folder with the deployment's contact types, instances, logo and hook
  deploymentDir: string;
  // signs and encrypts session tokens
  cookieKey: string;
  // signs and encrypts background-job tokens
  workerKey: string;
  // hex, 32 bytes: encrypts staged items and credentials
  secretKey: string;
  redisUrl: string;
  sessionTtlSeconds: number;
  // DATA_RETENTION_TTL: how long the app holds anything it stores. Each staged item, job (with its log
  // and archive) and generated password is removed this long after it was made (APP.md → Data storage)
  dataTtlSeconds: number;
  batchMaxItems: number;
  // a place type with more places than this is never read whole, only one parent at a time
  maxPlacesLoaded: number;
  allowAdminLogin: boolean;
  instances: Instance[];
  // hierarchy jobs (APP.md → Hierarchy management → Running the job)
  jobs: JobSettings;
};

export type JobSettings = {
  // postpone a job while Sentinel has more changes than this waiting
  maxSentinelBacklog: number;
  // how soon a postponed job checks again
  recheckSeconds: number;
  // DATA_RETENTION_TTL: a job, its log and archive, and the job token it carries, go this long after
  // it was scheduled
  ttlSeconds: number;
  // each job gets a folder of its own here for cht-conf's staged docs, removed when it ends
  workDir: string;
  // copies of every doc a delete or merge removes, kept with their job
  archiveDir: string;
  // one cht-conf action may take this long, with this much memory
  timeoutSeconds: number;
  chtConfHeapMb: number;
};

const MIN_KEY_LENGTH = 32;
const DEFAULT_SESSION_TTL_SECONDS = 24 * 60 * 60;
const DEFAULT_DATA_TTL_SECONDS = 14 * 24 * 60 * 60;
// replaced by DATA_RETENTION_TTL, the one lifetime for stored data
const RETIRED_TTLS = ['STAGED_LIST_TTL', 'CREDENTIALS_TTL', 'JOB_TTL', 'ARCHIVE_TTL'];
const DEFAULT_BATCH_MAX_ITEMS = 100;

type Env = Record<string, string | undefined>;

// Throws on any missing or invalid setting, so a misconfigured server refuses to start
export function loadSettings(source: Env, readFile: (path: string) => string = (path) => readFileSync(path, 'utf8')): Settings {
  const problems: string[] = [];
  const required = (name: string) => {
    const value = source[name];
    if (!value) {
      problems.push(`${name} is required`);
    }
    return value ?? '';
  };

  const cookieKey = required('COOKIE_PRIVATE_KEY');
  const workerKey = required('WORKER_PRIVATE_KEY');
  const secretKey = required('SECRET_KEY');
  const redisUrl = required('REDIS_URL');

  for (const [name, value] of [
    ['COOKIE_PRIVATE_KEY', cookieKey],
    ['WORKER_PRIVATE_KEY', workerKey]
  ]) {
    if (value && value.length < MIN_KEY_LENGTH) {
      problems.push(`${name} must be at least ${MIN_KEY_LENGTH} characters`);
    }
  }
  if (cookieKey && cookieKey === workerKey) {
    problems.push('COOKIE_PRIVATE_KEY and WORKER_PRIVATE_KEY must differ');
  }
  if (secretKey && !/^[0-9a-fA-F]{64}$/.test(secretKey)) {
    problems.push('SECRET_KEY must be 64 hex characters (32 bytes), eg. from `openssl rand -hex 32`');
  }
  if (redisUrl && !/^rediss?:\/\//.test(redisUrl)) {
    problems.push('REDIS_URL must start with redis:// or rediss://');
  }

  const positive = (unit: string) => (name: string, fallback: number) => {
    const value = source[name] ? Number(source[name]) : fallback;
    if (!Number.isInteger(value) || value <= 0) {
      problems.push(`${name} must be a positive number${unit}`);
    }
    return value;
  };
  const seconds = positive(' of seconds');
  const count = positive('');
  // PORT itself is read by the Node adapter (and vite.config.ts in development); checked here so a bad
  // value is reported with everything else
  if (source.PORT !== undefined) {
    const port = Number(source.PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      problems.push(`PORT must be a number between 1 and 65535, not "${source.PORT}"`);
    }
  }

  const sessionTtlSeconds = seconds('SESSION_TTL', DEFAULT_SESSION_TTL_SECONDS);
  const dataTtlSeconds = seconds('DATA_RETENTION_TTL', DEFAULT_DATA_TTL_SECONDS);
  for (const name of RETIRED_TTLS.filter((name) => source[name] !== undefined)) {
    problems.push(`${name} is no longer read: DATA_RETENTION_TTL is how long all stored data is kept`);
  }
  const batchMaxItems = count('BATCH_MAX_ITEMS', DEFAULT_BATCH_MAX_ITEMS);
  const maxPlacesLoaded = count('MAX_PLACES_LOADED', DEFAULT_MAX_PLACES_LOADED);

  const jobs: JobSettings = {
    maxSentinelBacklog: count('MAX_SENTINEL_BACKLOG', 7000),
    recheckSeconds: seconds('JOB_RECHECK', 15 * 60),
    ttlSeconds: dataTtlSeconds,
    workDir: source.JOB_WORK_DIR || join(tmpdir(), 'cht-iam-jobs'),
    archiveDir: source.ARCHIVE_LOCATION || 'data/archives',
    timeoutSeconds: seconds('JOB_TIMEOUT', 4 * 60 * 60),
    chtConfHeapMb: positive(' of megabytes')('CHT_CONF_HEAP_MB', 2048)
  };

  const production = source.NODE_ENV === 'production';
  const deploymentDir = required('DEPLOYMENT_DIR');
  const instances = readInstances(source, deploymentDir, production, readFile, problems);

  if (problems.length) {
    throw new Error(`Invalid configuration:\n- ${problems.join('\n- ')}`);
  }

  return {
    production,
    deploymentDir,
    cookieKey,
    workerKey,
    secretKey,
    redisUrl,
    sessionTtlSeconds,
    dataTtlSeconds,
    batchMaxItems,
    maxPlacesLoaded,
    allowAdminLogin: source.ALLOW_ADMIN_LOGIN !== 'false',
    instances,
    jobs
  };
}

// The deployment's instances.json
function readInstances(
  source: Env,
  deploymentDir: string,
  production: boolean,
  readFile: (path: string) => string,
  problems: string[]
): Instance[] {
  const instances: Instance[] = [];
  const path = join(deploymentDir, DEPLOYMENT_FILES.instances);

  let text: string | undefined;
  try {
    // DEPLOYMENT_DIR itself is reported as missing already
    text = deploymentDir ? readFile(path) : undefined;
  } catch {
    problems.push(
      existsSync(deploymentDir)
        ? `${path} could not be read: DEPLOYMENT_DIR must be a deployment's folder`
        : `DEPLOYMENT_DIR "${deploymentDir}" doesn't exist: point it at the deployment's folder, or mount the folder there`
    );
  }

  if (text !== undefined) {
    try {
      const parsed = instancesFileSchema.safeParse(JSON.parse(text));
      if (parsed.success) {
        instances.push(...parsed.data.instances);
      } else {
        problems.push(`${path}: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'} ${i.message}`).join('; ')}`);
      }
    } catch {
      problems.push(`${path} is not valid JSON`);
    }
  }

  // a local CHT for development; never offered in production
  if (!production && source.CHT_DEV_INSTANCE) {
    instances.push({
      id: 'dev',
      name: 'Development',
      host: source.CHT_DEV_INSTANCE,
      // https unless explicitly told otherwise, like every other instance
      useHttp: source.CHT_DEV_HTTP === 'true',
      idpOrigins: (source.CHT_DEV_IDP_ORIGINS ?? '').split(',').filter(Boolean)
    });
  }

  if (!instances.length && text !== undefined) {
    problems.push(`no CHT instances configured: list them in ${path}${production ? '' : ', or set CHT_DEV_INSTANCE'}`);
  }
  return instances;
}

let cached: Settings | undefined;

export function getSettings(): Settings {
  cached ??= loadSettings(env);
  return cached;
}
