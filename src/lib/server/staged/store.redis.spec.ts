import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { RedisStagedStore } from './store';
import type { ListOwner, StagedItem } from './types';
import { RedisUploadTracker } from './upload-tracker';

// Exercises the Lua scripts against a real Redis. Runs only when REDIS_TEST_URL is set, inside a
// random instance id, and removes its keys afterwards.
const url = process.env.REDIS_TEST_URL;
const SECRET = 'ab'.repeat(32);

describe.skipIf(!url)('Redis staged store', () => {
  let redis: Redis;
  const owner: ListOwner = { instanceId: `test-${randomUUID()}`, username: 'user:with/odd chars' };

  beforeAll(() => {
    redis = new Redis(url!);
  });

  afterAll(async () => {
    const keys = await redis.keys(`*${owner.instanceId}*`);
    if (keys.length) {
      await redis.del(...keys);
    }
    await redis.quit();
  });

  const item = (id: string, status: StagedItem['status'] = 'ready'): StagedItem => ({
    id,
    kind: 'create',
    request: { placeId: id, contact: { id: `c-${id}`, properties: { name: 'Jane', phone: '+254712345678' } } },
    source: { type: 'form' },
    status,
    summary: { title: `Place ${id}`, person: 'Jane' },
    revision: 0,
    sequence: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  it('stores items encrypted, checks revisions and keeps counts in step', async () => {
    const store = new RedisStagedStore(redis, SECRET, 60);

    const saved = await store.put(owner, item('a'), null);
    expect(saved.revision).toBe(1);
    await expect(store.put(owner, item('a'), null)).rejects.toMatchObject({ code: 'REVISION_MISMATCH' });

    const raw = Object.values(await redis.hgetall(`staged:${owner.instanceId}:${encodeURIComponent(owner.username)}`))[0];
    expect(raw).toMatch(/^1\|ready\|k1:/);
    expect(raw).not.toContain('Jane');
    expect(raw).not.toContain('+254712345678');

    const failed = await store.put(owner, { ...saved, status: 'failed' }, saved.revision);
    expect(failed.revision).toBe(2);
    await expect(store.put(owner, { ...saved, status: 'created' }, saved.revision)).rejects.toMatchObject({ code: 'REVISION_MISMATCH' });

    await store.put(owner, item('b'), null);
    expect(await store.counts(owner)).toEqual({ failed: 1, ready: 1 });
    expect((await store.get(owner, 'a'))?.status).toBe('failed');
    expect((await store.list(owner)).map((i) => i.id).sort()).toEqual(['a', 'b']);

    expect(await store.remove(owner, 'a')).toBe(true);
    expect(await store.remove(owner, 'a')).toBe(false);
    expect(await store.counts(owner)).toEqual({ ready: 1 });
    expect(await redis.ttl(`staged:${owner.instanceId}:${encodeURIComponent(owner.username)}`)).toBeGreaterThan(0);
  });

  it('allows one upload per list, released only by the run that holds it', async () => {
    const tracker = new RedisUploadTracker(redis);

    const runId = await tracker.begin(owner, 3);
    expect(runId).toBeDefined();
    expect(await tracker.begin(owner, 3)).toBeUndefined();

    await tracker.step(owner);
    expect(await tracker.state(owner)).toEqual({ state: 'running', done: 1, total: 3 });

    await tracker.end(owner, 'someone-else');
    expect((await tracker.state(owner)).state).toBe('running');
    await tracker.end(owner, runId!);
    expect((await tracker.state(owner)).state).toBe('idle');
  });
});
