import type { Redis } from 'ioredis';

import { decrypt, encrypt } from '../crypto';

// Hierarchy jobs (APP.md → Hierarchy management → Running the job, Job status), kept in Redis so they
// survive restarts. One queue per CHT instance; each instance runs one job at a time.

// restore: undoing a delete, from its archive
export const JOB_KINDS = ['move', 'merge', 'delete', 'restore'] as const;
export type JobKind = (typeof JOB_KINDS)[number];
export const JOB_STATUSES = ['queued', 'postponed', 'needs_sign_in', 'running', 'done', 'failed'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const FINISHED: JobStatus[] = ['done', 'failed'];

export type HierarchyJob = {
	id: string;
	kind: JobKind;
	instanceId: string;
	createdBy: string;
	request: Record<string, any>;
	// the branch it works on, for refusing overlapping jobs: the place, and the ids above it
	branch: { placeId: string; placeName: string; lineage: string[] };
	// a merge: the place it merges into
	target?: { placeId: string; placeName: string };
	status: JobStatus;
	// the job token (APP.md → Auth): the user's CHT session, encrypted for background use
	token?: string;
	postponed?: { reason: 'sentinel_backlog' | 'instance_down'; backlog?: number; nextCheckAt: string };
	progress?: { written: number; total: number };
	// how far a run got, so a re-run knows what's already been done
	phase?: 'staged' | 'archived' | 'uploaded';
	result?: {
		contacts: number;
		reports: number;
		durationMs: number;
		// delete: what cht-conf did to the accounts
		usersDisabled?: number;
		usersUpdated?: number;
		// restore: accounts given their places back, and logins recreated for disabled ones
		accountsRestored?: number;
		loginsRecreated?: { username: string; previousUsername: string }[];
	};
	// delete: the accounts at the deleted places, recorded before anything changed, for an undo
	accounts?: { username: string; contactId?: string; placeIds: string[]; disabled: boolean }[];
	// delete: the restore job that undid it
	undoneBy?: string;
	error?: { message: string; logTail: string[] };
	archive?: { available: boolean; docs: number; expiresAt: string };
	attempts: number;
	createdAt: string;
	updatedAt: string;
	startedAt?: string;
	finishedAt?: string;
};

export interface JobStore {
	get(instanceId: string, id: string): Promise<HierarchyJob | undefined>;
	save(job: HierarchyJob): Promise<HierarchyJob>;
	// jobs not yet finished, in the order they were scheduled
	queue(instanceId: string): Promise<HierarchyJob[]>;
	forUser(instanceId: string, username: string): Promise<HierarchyJob[]>;
	instancesWithWork(): Promise<string[]>;
	// one runner per instance at a time, across server instances
	lock(instanceId: string, owner: string, ms: number): Promise<boolean>;
	unlock(instanceId: string, owner: string): Promise<void>;
	appendLog(instanceId: string, id: string, lines: string[]): Promise<void>;
	log(instanceId: string, id: string): Promise<string[]>;
}

const LOG_LINES = 5000;
const EXTEND_OR_TAKE = `
local current = redis.call('GET', KEYS[1])
if current == false or current == ARGV[1] then return redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2]) end
return false
`;
const RELEASE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
`;

export class RedisJobStore implements JobStore {
	constructor(
		private readonly redis: Redis,
		private readonly secretKey: string,
		private readonly ttlSeconds: number
	) {}

	async get(instanceId: string, id: string): Promise<HierarchyJob | undefined> {
		const value = await this.redis.get(this.jobKey(instanceId, id));
		return value ? (JSON.parse(decrypt(value, this.secretKey)) as HierarchyJob) : undefined;
	}

	async save(job: HierarchyJob): Promise<HierarchyJob> {
		const saved = { ...job, updatedAt: new Date().toISOString() };
		const finished = FINISHED.includes(saved.status);
		const tx = this.redis.multi().set(this.jobKey(job.instanceId, job.id), encrypt(JSON.stringify(saved), this.secretKey));
		tx.zadd(this.userKey(job.instanceId, job.createdBy), Date.parse(job.createdAt), job.id);
		if (finished) {
			tx.expire(this.jobKey(job.instanceId, job.id), this.ttlSeconds).expire(this.logKey(job.instanceId, job.id), this.ttlSeconds);
			tx.lrem(this.queueKey(job.instanceId), 0, job.id);
		} else {
			tx.persist(this.jobKey(job.instanceId, job.id)).sadd('jobs:instances', job.instanceId);
		}
		await tx.exec();
		if (!finished) {
			// added once, at the end: the queue keeps the order jobs were scheduled in
			const queued = await this.redis.lpos(this.queueKey(job.instanceId), job.id);
			if (queued === null) await this.redis.rpush(this.queueKey(job.instanceId), job.id);
		}
		return saved;
	}

	async queue(instanceId: string): Promise<HierarchyJob[]> {
		const ids = await this.redis.lrange(this.queueKey(instanceId), 0, -1);
		const jobs = await Promise.all(ids.map((id) => this.get(instanceId, id)));
		return jobs.filter((job): job is HierarchyJob => !!job && !FINISHED.includes(job.status));
	}

	async forUser(instanceId: string, username: string): Promise<HierarchyJob[]> {
		const ids = await this.redis.zrevrange(this.userKey(instanceId, username), 0, -1);
		const jobs = await Promise.all(ids.map((id) => this.get(instanceId, id)));
		const gone = ids.filter((_, index) => !jobs[index]);
		if (gone.length) await this.redis.zrem(this.userKey(instanceId, username), ...gone);
		return jobs.filter((job): job is HierarchyJob => !!job);
	}

	async instancesWithWork(): Promise<string[]> {
		const instances = await this.redis.smembers('jobs:instances');
		const withWork: string[] = [];
		for (const instanceId of instances) {
			if (await this.redis.llen(this.queueKey(instanceId))) withWork.push(instanceId);
			else await this.redis.srem('jobs:instances', instanceId);
		}
		return withWork;
	}

	async lock(instanceId: string, owner: string, ms: number): Promise<boolean> {
		return (await this.redis.eval(EXTEND_OR_TAKE, 1, `jobs:${instanceId}:lock`, owner, String(ms))) === 'OK';
	}

	async unlock(instanceId: string, owner: string): Promise<void> {
		await this.redis.eval(RELEASE, 1, `jobs:${instanceId}:lock`, owner);
	}

	async appendLog(instanceId: string, id: string, lines: string[]): Promise<void> {
		if (!lines.length) return;
		await this.redis.multi().rpush(this.logKey(instanceId, id), ...lines).ltrim(this.logKey(instanceId, id), -LOG_LINES, -1).exec();
	}

	async log(instanceId: string, id: string): Promise<string[]> {
		return this.redis.lrange(this.logKey(instanceId, id), 0, -1);
	}

	private jobKey = (instanceId: string, id: string) => `job:${instanceId}:${id}`;
	private logKey = (instanceId: string, id: string) => `job:${instanceId}:${id}:log`;
	private queueKey = (instanceId: string) => `jobs:${instanceId}:queue`;
	private userKey = (instanceId: string, username: string) => `jobs:${instanceId}:user:${encodeURIComponent(username)}`;
}

// For tests
export class MemoryJobStore implements JobStore {
	readonly jobs = new Map<string, HierarchyJob>();
	private readonly order: string[] = [];
	private readonly logs = new Map<string, string[]>();
	private readonly locks = new Map<string, string>();

	async get(instanceId: string, id: string) {
		const job = this.jobs.get(`${instanceId}:${id}`);
		return job && structuredClone(job);
	}

	async save(job: HierarchyJob) {
		const saved = { ...structuredClone(job), updatedAt: new Date().toISOString() };
		const key = `${job.instanceId}:${job.id}`;
		this.jobs.set(key, saved);
		if (!this.order.includes(key)) this.order.push(key);
		return structuredClone(saved);
	}

	async queue(instanceId: string) {
		return this.order
			.map((key) => this.jobs.get(key)!)
			.filter((job) => job.instanceId === instanceId && !FINISHED.includes(job.status))
			.map((job) => structuredClone(job));
	}

	async forUser(instanceId: string, username: string) {
		return [...this.order]
			.reverse()
			.map((key) => this.jobs.get(key)!)
			.filter((job) => job.instanceId === instanceId && job.createdBy === username)
			.map((job) => structuredClone(job));
	}

	async instancesWithWork() {
		return [...new Set([...this.jobs.values()].filter((job) => !FINISHED.includes(job.status)).map((job) => job.instanceId))];
	}

	async lock(instanceId: string, owner: string) {
		const current = this.locks.get(instanceId);
		if (current && current !== owner) return false;
		this.locks.set(instanceId, owner);
		return true;
	}

	async unlock(instanceId: string, owner: string) {
		if (this.locks.get(instanceId) === owner) this.locks.delete(instanceId);
	}

	async appendLog(instanceId: string, id: string, lines: string[]) {
		const key = `${instanceId}:${id}`;
		this.logs.set(key, [...(this.logs.get(key) ?? []), ...lines].slice(-LOG_LINES));
	}

	async log(instanceId: string, id: string) {
		return [...(this.logs.get(`${instanceId}:${id}`) ?? [])];
	}
}
