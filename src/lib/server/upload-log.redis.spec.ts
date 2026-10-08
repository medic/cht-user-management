import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { credentialsKey, RedisUploadLog, type UploadLogRecord } from './upload-log';

// Against a real Redis, only when REDIS_TEST_URL is set, inside a random instance id whose keys are
// removed afterwards
const url = process.env.REDIS_TEST_URL;
const SECRET = 'cd'.repeat(32);
const DAY = 24 * 60 * 60; // seconds, as the TTL
const DAY_MS = DAY * 1000; // the clock is in milliseconds

describe.skipIf(!url)('Redis credentials record', () => {
  let redis: Redis;
  const owner = { instanceId: `test-${randomUUID()}`, username: 'manager' };
  const record = (username: string): Omit<UploadLogRecord, 'id'> => ({
    place: 'Kanyakwar',
    person: 'Jane',
    phone: '+254712345678',
    contactType: 'c_community_health_unit',
    credentials: { username, password: 'secret-password', placeId: `place-${username}`, contactId: `contact-${username}` },
    hierarchy: {}
  });

  beforeAll(() => {
    redis = new Redis(url!);
  });

  afterAll(async () => {
    const keys = await redis.keys(`*${owner.instanceId}*`);
    if (keys.length) await redis.del(...keys);
    await redis.quit();
  });

  it('forgets each password ttl after it was made, even while newer ones keep arriving', async () => {
    let now = Date.parse('2026-09-01T00:00:00Z');
    const log = new RedisUploadLog(redis, SECRET, 5 * DAY, () => now);

    await log.log(owner, record('first'));
    now += 3 * DAY_MS;
    await log.log(owner, record('second'));
    expect((await log.list(owner)).map((r) => r.credentials.username)).toEqual(['second', 'first']);

    // the first is 6 days old, the second 3: a write every few days no longer keeps the first
    now += 3 * DAY_MS;
    await log.log(owner, record('third'));
    expect((await log.list(owner)).map((r) => r.credentials.username)).toEqual(['third', 'second']);
    expect(await redis.zcard(credentialsKey(owner))).toBe(2);

    // reading removes expired entries too, and the key lives as long as its newest entry
    now += 4 * DAY_MS;
    expect((await log.list(owner)).map((r) => r.credentials.username)).toEqual(['third']);
    expect(await redis.ttl(credentialsKey(owner))).toBeGreaterThan(4 * DAY);
  });

  it('keeps the passwords encrypted at rest', async () => {
    const [stored] = await redis.zrange(credentialsKey(owner), '0', '0');
    expect(stored).not.toContain('secret-password');
    expect(stored).not.toContain('Kanyakwar');
  });
});
