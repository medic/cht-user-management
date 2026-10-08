import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { RedisJobStore, type HierarchyJob } from './jobs';

// Against a real Redis, only when REDIS_TEST_URL is set, inside a random instance id whose keys are
// removed afterwards
const url = process.env.REDIS_TEST_URL;
const SECRET = 'ef'.repeat(32);

describe.skipIf(!url)('Redis job store', () => {
  let redis: Redis;
  const instanceId = `test-${randomUUID()}`;
  const job = (id: string, status: HierarchyJob['status']): HierarchyJob => ({
    id,
    kind: 'delete',
    instanceId,
    createdBy: 'manager',
    request: { placeId: 'chu' },
    branch: { placeId: 'chu', placeName: 'Kanyakwar', lineage: ['sub'] },
    status,
    attempts: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  beforeAll(() => {
    redis = new Redis(url!);
  });

  afterAll(async () => {
    const keys = await redis.keys(`*${instanceId}*`);
    if (keys.length) await redis.del(...keys);
    await redis.quit();
  });

  it('removes a job with its log, from the user’s list and from the queue', async () => {
    const store = new RedisJobStore(redis, SECRET, 3600);
    const [done, queued] = [randomUUID(), randomUUID()];
    await store.save(job(done, 'done'));
    await store.save(job(queued, 'queued'));
    await store.appendLog(instanceId, done, ['Started, attempt 1.']);
    expect((await store.forUser(instanceId, 'manager')).map((j) => j.id).sort()).toEqual([done, queued].sort());

    await store.remove(instanceId, done, 'manager');
    await store.remove(instanceId, queued, 'manager');

    expect(await store.get(instanceId, done)).toBeUndefined();
    expect(await store.log(instanceId, done)).toEqual([]);
    expect(await store.forUser(instanceId, 'manager')).toEqual([]);
    expect(await store.queue(instanceId)).toEqual([]);
    expect(await redis.keys(`*${instanceId}*`)).toEqual([]);
  });
});

describe.skipIf(!url)('Redis job store expiry', () => {
  let redis: Redis;
  const instanceId = `test-${randomUUID()}`;
  const HOUR = 3600;
  const job = (id: string, status: HierarchyJob['status'], finishedAt?: string): HierarchyJob => ({
    id,
    kind: 'move',
    instanceId,
    createdBy: 'manager',
    request: { placeId: 'chu' },
    branch: { placeId: 'chu', placeName: 'Kanyakwar', lineage: ['sub'] },
    status,
    attempts: 1,
    createdAt: new Date(Date.now() - 30 * 24 * HOUR * 1000).toISOString(),
    updatedAt: new Date().toISOString(),
    ...(finishedAt && { finishedAt })
  });
  const key = (id: string) => `job:${instanceId}:${id}`;

  beforeAll(() => {
    redis = new Redis(url!);
  });

  afterAll(async () => {
    const keys = await redis.keys(`*${instanceId}*`);
    if (keys.length) await redis.del(...keys);
    await redis.quit();
  });

  it('expires a job that succeeded, ttl after it finished, with its log; keeps the rest however old', async () => {
    const store = new RedisJobStore(redis, SECRET, HOUR);
    const [done, failed, queued, old] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    // scheduled 30 days ago, all of them
    await store.save(job(queued, 'queued'));
    await store.appendLog(instanceId, queued, ['waiting']);
    await store.save(job(failed, 'failed', new Date().toISOString()));
    await store.save(job(done, 'done', new Date().toISOString()));
    await store.appendLog(instanceId, done, ['Done.']);
    await store.save(job(old, 'done', new Date(Date.now() - 2 * HOUR * 1000).toISOString()));

    for (const id of [queued, failed]) expect(await redis.ttl(key(id)), id).toBe(-1);
    expect(await redis.ttl(`${key(queued)}:log`)).toBe(-1);
    // an hour from when it finished, and its log with it
    expect(await redis.ttl(key(done))).toBeGreaterThan(HOUR - 5);
    expect(Math.abs((await redis.pttl(`${key(done)}:log`)) - (await redis.pttl(key(done))))).toBeLessThan(1000);
    // one that finished longer ago than that is removed as it's saved
    expect(await store.get(instanceId, old)).toBeUndefined();

    // a queued job that's retried and later succeeds starts expiring then
    await store.save({ ...job(queued, 'done', new Date().toISOString()) });
    expect(await redis.ttl(key(queued))).toBeGreaterThan(HOUR - 5);
  });
});
