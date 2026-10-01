import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';

import type { ListOwner } from './types';

export type UploadState = { state: 'running' | 'idle'; done: number; total: number };

// One upload per staged list at a time, visible from every server instance. The lock expires
// unless the running upload keeps extending it, so a server that dies mid-upload doesn't block the
// list forever (APP.md → Data storage → Run locks).
export interface UploadTracker {
  // a run id, or undefined when an upload is already running
  begin(owner: ListOwner, total: number): Promise<string | undefined>;
  step(owner: ListOwner): Promise<void>;
  heartbeat(owner: ListOwner, runId: string): Promise<void>;
  end(owner: ListOwner, runId: string): Promise<void>;
  state(owner: ListOwner): Promise<UploadState>;
}

export const LOCK_MS = 60_000;

const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
`;
const EXTEND_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], ARGV[2]) end
return 0
`;

// `name` separates the kinds of run: "upload", or "validation" for background CSV checks
export class RedisUploadTracker implements UploadTracker {
  constructor(
    private readonly redis: Redis,
    private readonly name: 'upload' | 'validation' = 'upload'
  ) {}

  async begin(owner: ListOwner, total: number): Promise<string | undefined> {
    const runId = randomUUID();
    const acquired = await this.redis.set(this.lockKey(owner), runId, 'PX', LOCK_MS, 'NX');
    if (acquired !== 'OK') {
      return undefined;
    }
    await this.redis.multi().hset(this.progressKey(owner), { total, done: 0 }).expire(this.progressKey(owner), 86_400).exec();
    return runId;
  }

  async step(owner: ListOwner): Promise<void> {
    await this.redis.hincrby(this.progressKey(owner), 'done', 1);
  }

  async heartbeat(owner: ListOwner, runId: string): Promise<void> {
    await this.redis.eval(EXTEND_SCRIPT, 1, this.lockKey(owner), runId, String(LOCK_MS));
  }

  async end(owner: ListOwner, runId: string): Promise<void> {
    await this.redis.eval(RELEASE_SCRIPT, 1, this.lockKey(owner), runId);
  }

  async state(owner: ListOwner): Promise<UploadState> {
    const [running, progress] = await Promise.all([this.redis.exists(this.lockKey(owner)), this.redis.hgetall(this.progressKey(owner))]);
    return { state: running ? 'running' : 'idle', done: Number(progress.done ?? 0), total: Number(progress.total ?? 0) };
  }

  private lockKey(owner: ListOwner): string {
    return `lock:${owner.instanceId}:${encodeURIComponent(owner.username)}:${this.name}`;
  }

  private progressKey(owner: ListOwner): string {
    return `staged:${owner.instanceId}:${encodeURIComponent(owner.username)}:${this.name}`;
  }
}

export class MemoryUploadTracker implements UploadTracker {
  private readonly runs = new Map<string, { runId?: string; done: number; total: number }>();

  async begin(owner: ListOwner, total: number): Promise<string | undefined> {
    const run = this.runs.get(this.key(owner));
    if (run?.runId) {
      return undefined;
    }
    const runId = randomUUID();
    this.runs.set(this.key(owner), { runId, done: 0, total });
    return runId;
  }

  async step(owner: ListOwner): Promise<void> {
    const run = this.runs.get(this.key(owner));
    if (run) {
      run.done++;
    }
  }

  async heartbeat(): Promise<void> {}

  async end(owner: ListOwner, runId: string): Promise<void> {
    const run = this.runs.get(this.key(owner));
    if (run?.runId === runId) {
      run.runId = undefined;
    }
  }

  async state(owner: ListOwner): Promise<UploadState> {
    const run = this.runs.get(this.key(owner));
    return { state: run?.runId ? 'running' : 'idle', done: run?.done ?? 0, total: run?.total ?? 0 };
  }

  private key(owner: ListOwner): string {
    return `${owner.instanceId}:${owner.username}`;
  }
}
