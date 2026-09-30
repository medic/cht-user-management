import type { Redis } from 'ioredis';

// Tokens revoked at logout, kept until they would have expired anyway (APP.md → Data storage)
export interface RevocationList {
	revoke(jti: string, expiresAt: Date): Promise<void>;
	isRevoked(jti: string): Promise<boolean>;
}

export class RedisRevocationList implements RevocationList {
	constructor(private readonly redis: Redis) {}

	async revoke(jti: string, expiresAt: Date): Promise<void> {
		const ttlSeconds = Math.ceil((expiresAt.getTime() - Date.now()) / 1000);
		if (ttlSeconds > 0) {
			await this.redis.set(`revoked:${jti}`, '1', 'EX', ttlSeconds);
		}
	}

	async isRevoked(jti: string): Promise<boolean> {
		return (await this.redis.exists(`revoked:${jti}`)) === 1;
	}
}

export class MemoryRevocationList implements RevocationList {
	private readonly revoked = new Map<string, number>();

	async revoke(jti: string, expiresAt: Date): Promise<void> {
		this.revoked.set(jti, expiresAt.getTime());
	}

	async isRevoked(jti: string): Promise<boolean> {
		const until = this.revoked.get(jti);
		return until !== undefined && until > Date.now();
	}
}
