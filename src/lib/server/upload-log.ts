import crypto from 'node:crypto';
import type { Redis } from 'ioredis';

// Generated credentials, encrypted and kept for a limited time so they can be shown again.
// Still in its early shape: APP.md → Data storage keys them by instance too, as `credentials:{instance}:{user}`.
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
	log(creator: string, record: Omit<UploadLogRecord, 'id'>): Promise<void>;
	list(creator: string): Promise<UploadLogRecord[]>;
}

export class RedisUploadLog implements UploadLog {
	constructor(
		private readonly redis: Redis,
		private readonly secretKeyHex: string,
		private readonly ttlSeconds: number
	) {}

	async log(creator: string, record: Omit<UploadLogRecord, 'id'>): Promise<void> {
		const key = `${creator}:creation-log`;
		const encrypted = this.encrypt(JSON.stringify({ id: crypto.randomUUID(), ...record }));
		await this.redis.pipeline().zadd(key, Date.now(), encrypted).expire(key, this.ttlSeconds).exec();
	}

	async list(creator: string): Promise<UploadLogRecord[]> {
		const entries = await this.redis.zrevrange(`${creator}:creation-log`, 0, -1);
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

// Used when Redis isn't configured: nothing is retained, so replays can't return passwords
export class DisabledUploadLog implements UploadLog {
	async log(): Promise<void> {}
	async list(): Promise<UploadLogRecord[]> {
		return [];
	}
}

export async function findCredentials(
	uploadLog: UploadLog,
	creator: string,
	contactId: string
): Promise<UploadLogRecord['credentials'] | undefined> {
	const records = await uploadLog.list(creator);
	return records.find((record) => record.credentials?.contactId === contactId && record.credentials.password)?.credentials;
}
