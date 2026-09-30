import crypto from 'node:crypto';
import type { Redis } from 'ioredis';

// Generated credentials, encrypted and kept for a limited time so they can be shown again. Kept per
// instance and user (APP.md → Data storage): the same username on two instances is two people
export type CredentialsOwner = { instanceId: string; username: string };

export function credentialsKey({ instanceId, username }: CredentialsOwner): string {
  return `credentials:${instanceId}:${encodeURIComponent(username)}`;
}

export type UploadLogRecord = {
  id: string;
  place: string;
  person: string;
  phone: string;
  contactType: string;
  credentials: {
    username?: string;
    password?: string;
    placeId?: string;
    contactId?: string;
    created_at?: number;
  };
  hierarchy: Record<string, string>;
};

export interface UploadLog {
  log(owner: CredentialsOwner, record: Omit<UploadLogRecord, 'id'>): Promise<void>;
  list(owner: CredentialsOwner): Promise<UploadLogRecord[]>;
}

export class RedisUploadLog implements UploadLog {
  constructor(
    private readonly redis: Redis,
    private readonly secretKeyHex: string,
    private readonly ttlSeconds: number
  ) {}

  async log(owner: CredentialsOwner, record: Omit<UploadLogRecord, 'id'>): Promise<void> {
    const key = credentialsKey(owner);
    const encrypted = this.encrypt(JSON.stringify({ id: crypto.randomUUID(), ...record }));
    await this.redis.pipeline().zadd(key, Date.now(), encrypted).expire(key, this.ttlSeconds).exec();
  }

  async list(owner: CredentialsOwner): Promise<UploadLogRecord[]> {
    const entries = await this.redis.zrevrange(credentialsKey(owner), 0, -1);
    return entries.map((entry) => JSON.parse(this.decrypt(entry)));
  }

  private encrypt(text: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(this.secretKeyHex, 'hex'), iv);
    const encrypted = cipher.update(text, 'utf8', 'hex') + cipher.final('hex');
    return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${encrypted}`;
  }

  private decrypt(text: string): string {
    const [ivHex, authTagHex, encrypted] = text.split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(this.secretKeyHex, 'hex'), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    return decipher.update(encrypted, 'hex', 'utf8') + decipher.final('utf8');
  }
}

// For tests: kept per owner, as in Redis. `records` is every owner's, newest first
export class MemoryUploadLog implements UploadLog {
  private readonly byOwner = new Map<string, UploadLogRecord[]>();
  records: UploadLogRecord[] = [];

  async log(owner: CredentialsOwner, record: Omit<UploadLogRecord, 'id'>): Promise<void> {
    const saved = { id: String(this.records.length), ...record };
    this.records.unshift(saved);
    this.byOwner.set(credentialsKey(owner), [saved, ...(this.byOwner.get(credentialsKey(owner)) ?? [])]);
  }

  async list(owner: CredentialsOwner): Promise<UploadLogRecord[]> {
    return this.byOwner.get(credentialsKey(owner)) ?? [];
  }
}

// Used when Redis isn't configured: nothing is retained, so replays can't return passwords
export class DisabledUploadLog implements UploadLog {
  async log(): Promise<void> {}
  async list(): Promise<UploadLogRecord[]> {
    return [];
  }
}

export async function findCredentials(
  uploadLog: UploadLog,
  owner: CredentialsOwner,
  contactId: string
): Promise<UploadLogRecord['credentials'] | undefined> {
  const records = await uploadLog.list(owner);
  return records.find((record) => record.credentials?.contactId === contactId && record.credentials.password)?.credentials;
}
