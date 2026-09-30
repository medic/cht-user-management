import type { Redis } from 'ioredis';

import { decrypt, encrypt } from '../crypto';
import { ApiError } from '../errors';
import type { ListOwner, StagedItem, StagedStatus, StatusCounts } from './types';

// Persistence for staged lists. `put` checks the revision, writes the item and adjusts the status
// counts as one step, so concurrent edits can't overwrite each other and the counts can't drift.
export interface StagedStore {
  list(owner: ListOwner): Promise<StagedItem[]>;
  get(owner: ListOwner, id: string): Promise<StagedItem | undefined>;
  counts(owner: ListOwner): Promise<StatusCounts>;
  // expectedRevision null: the item must not exist yet. Returns the item as saved, with its new revision
  put(owner: ListOwner, item: StagedItem, expectedRevision: number | null): Promise<StagedItem>;
  remove(owner: ListOwner, id: string): Promise<boolean>;
}

export function revisionMismatch(): ApiError {
  return new ApiError(409, 'REVISION_MISMATCH', 'This item changed since you opened it. Reload it and try again.');
}

function saved(item: StagedItem, expectedRevision: number | null): StagedItem {
  return { ...item, revision: (expectedRevision ?? 0) + 1, updatedAt: new Date().toISOString() };
}

// Values are stored as "<revision>|<status>|<encrypted item>", so the Lua scripts can check the
// revision and move the counts without decrypting anything
const PUT_SCRIPT = `
local current = redis.call('HGET', KEYS[1], ARGV[1])
if ARGV[2] == '' then
	if current then return redis.error_reply('REVISION') end
else
	if not current then return redis.error_reply('REVISION') end
	local revision, status = string.match(current, '^(%d+)|([^|]+)|')
	if revision ~= ARGV[2] then return redis.error_reply('REVISION') end
	redis.call('HINCRBY', KEYS[2], status, -1)
end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[3])
redis.call('HINCRBY', KEYS[2], ARGV[4], 1)
redis.call('EXPIRE', KEYS[1], ARGV[5])
redis.call('EXPIRE', KEYS[2], ARGV[5])
return 1
`;

const REMOVE_SCRIPT = `
local current = redis.call('HGET', KEYS[1], ARGV[1])
if not current then return 0 end
local status = string.match(current, '^%d+|([^|]+)|')
redis.call('HDEL', KEYS[1], ARGV[1])
redis.call('HINCRBY', KEYS[2], status, -1)
return 1
`;

export class RedisStagedStore implements StagedStore {
  constructor(
    private readonly redis: Redis,
    private readonly secretKeyHex: string,
    private readonly ttlSeconds: number
  ) {}

  async list(owner: ListOwner): Promise<StagedItem[]> {
    const values = await this.redis.hgetall(this.itemsKey(owner));
    return Object.values(values).map((value) => this.decode(value));
  }

  async get(owner: ListOwner, id: string): Promise<StagedItem | undefined> {
    const value = await this.redis.hget(this.itemsKey(owner), id);
    return value ? this.decode(value) : undefined;
  }

  async counts(owner: ListOwner): Promise<StatusCounts> {
    const raw = await this.redis.hgetall(this.countsKey(owner));
    return Object.fromEntries(
      Object.entries(raw)
        .map(([status, n]) => [status, Number(n)])
        .filter(([, n]) => (n as number) > 0)
    );
  }

  async put(owner: ListOwner, item: StagedItem, expectedRevision: number | null): Promise<StagedItem> {
    const next = saved(item, expectedRevision);
    try {
      await this.redis.eval(
        PUT_SCRIPT,
        2,
        this.itemsKey(owner),
        this.countsKey(owner),
        next.id,
        expectedRevision === null ? '' : String(expectedRevision),
        this.encode(next),
        next.status,
        String(this.ttlSeconds)
      );
    } catch (e) {
      if ((e as Error).message?.includes('REVISION')) {
        throw revisionMismatch();
      }
      throw e;
    }
    return next;
  }

  async remove(owner: ListOwner, id: string): Promise<boolean> {
    return (await this.redis.eval(REMOVE_SCRIPT, 2, this.itemsKey(owner), this.countsKey(owner), id)) === 1;
  }

  private itemsKey(owner: ListOwner): string {
    return `staged:${owner.instanceId}:${encodeURIComponent(owner.username)}`;
  }

  private countsKey(owner: ListOwner): string {
    return `${this.itemsKey(owner)}:counts`;
  }

  private encode(item: StagedItem): string {
    return `${item.revision}|${item.status}|${encrypt(JSON.stringify({ v: 1, item }), this.secretKeyHex)}`;
  }

  private decode(value: string): StagedItem {
    const encrypted = value.split('|').slice(2).join('|');
    const { item } = JSON.parse(decrypt(encrypted, this.secretKeyHex)) as { v: number; item: StagedItem };
    return item;
  }
}

// Same rules as the Redis store, for tests
export class MemoryStagedStore implements StagedStore {
  private readonly lists = new Map<string, Map<string, StagedItem>>();

  async list(owner: ListOwner): Promise<StagedItem[]> {
    return [...this.items(owner).values()].map((item) => structuredClone(item));
  }

  async get(owner: ListOwner, id: string): Promise<StagedItem | undefined> {
    const item = this.items(owner).get(id);
    return item && structuredClone(item);
  }

  async counts(owner: ListOwner): Promise<StatusCounts> {
    const counts: StatusCounts = {};
    for (const { status } of this.items(owner).values()) {
      counts[status as StagedStatus] = (counts[status as StagedStatus] ?? 0) + 1;
    }
    return counts;
  }

  async put(owner: ListOwner, item: StagedItem, expectedRevision: number | null): Promise<StagedItem> {
    const items = this.items(owner);
    const current = items.get(item.id);
    if (expectedRevision === null ? current : current?.revision !== expectedRevision) {
      throw revisionMismatch();
    }
    const next = saved(item, expectedRevision);
    items.set(item.id, structuredClone(next));
    return next;
  }

  async remove(owner: ListOwner, id: string): Promise<boolean> {
    return this.items(owner).delete(id);
  }

  private items(owner: ListOwner): Map<string, StagedItem> {
    const key = `${owner.instanceId}:${owner.username}`;
    let items = this.lists.get(key);
    if (!items) {
      items = new Map();
      this.lists.set(key, items);
    }
    return items;
  }
}
