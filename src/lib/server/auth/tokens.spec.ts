import { describe, expect, it } from 'vitest';

import { authenticate } from './authenticate';
import type { Instance } from './instances';
import { MemoryRevocationList } from './revocation';
import { assertAuthorized, presentedToken, type Session } from './session';
import { issueToken, readToken } from './tokens';

const KEY = 'k'.repeat(40);
const OTHER_KEY = 'o'.repeat(40);
const instance: Instance = { id: 'test', name: 'Test', host: 'cht.example.org', useHttp: false, idpOrigins: [] };
const session: Session = {
	instanceId: 'test',
	username: 'alice',
	sessionCookie: 'AuthSession=abc123',
	facilityIds: ['sub-1'],
	chtVersion: '4.18.0',
	isAdmin: false
};

describe('tokens', () => {
	it('round-trips the session, with an id and an expiry', async () => {
		const issued = await issueToken('session', session, KEY, 3600);
		const read = await readToken('session', issued.token, KEY);

		expect(read).toEqual({ session, jti: issued.jti, expiresAt: issued.expiresAt });
	});

	it('never reveals the CouchDB session inside the token', async () => {
		const { token } = await issueToken('session', session, KEY, 3600);
		const decoded = token
			.split('.')
			.map((part) => Buffer.from(part, 'base64url').toString('latin1'))
			.join('');

		expect(decoded).not.toContain('abc123');
		expect(decoded).not.toContain('alice');
	});

	it('rejects tampered, expired and wrongly keyed tokens', async () => {
		const { token } = await issueToken('session', session, KEY, 60);
		const parts = token.split('.');
		// the first character: the last one may only carry padding bits, which change nothing
		parts[3] = parts[3].replace(/^./, (c) => (c === 'A' ? 'B' : 'A'));

		await expect(readToken('session', parts.join('.'), KEY)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
		await expect(readToken('session', token, OTHER_KEY)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
		await expect(readToken('session', token, KEY, new Date(Date.now() + 120_000))).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
	});

	it('keeps job tokens and session tokens apart, even with the same secret', async () => {
		const job = await issueToken('job', session, KEY, 3600);
		await expect(readToken('session', job.token, KEY)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
	});
});

describe('authenticate', () => {
	it('accepts a valid token until it is revoked', async () => {
		const revocations = new MemoryRevocationList();
		const issued = await issueToken('session', session, KEY, 3600);
		const options = { cookieKey: KEY, revocations, instances: [instance] };

		expect((await authenticate(issued.token, options)).instance).toEqual(instance);

		await revocations.revoke(issued.jti, issued.expiresAt);
		await expect(authenticate(issued.token, options)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
	});

	it('rejects a session whose instance is no longer configured', async () => {
		const { token } = await issueToken('session', session, KEY, 3600);
		await expect(authenticate(token, { cookieKey: KEY, revocations: new MemoryRevocationList(), instances: [] })).rejects.toMatchObject({
			code: 'UNAUTHENTICATED'
		});
	});
});

describe('session helpers', () => {
	it('prefers the bearer header over the cookie', () => {
		expect(presentedToken('Bearer abc', 'cookie')).toBe('abc');
		expect(presentedToken(null, 'cookie')).toBe('cookie');
		expect(presentedToken('Basic abc', undefined)).toBeUndefined();
	});

	it('allows places under one of the facilities, and admins everywhere', () => {
		expect(() => assertAuthorized(session, ['chu-1', 'sub-1'])).not.toThrow();
		expect(() => assertAuthorized(session, ['chu-9', 'sub-9'])).toThrow(expect.objectContaining({ code: 'FORBIDDEN_PLACE' }));
		expect(() => assertAuthorized({ ...session, facilityIds: ['*'] }, ['anything'])).not.toThrow();
	});
});
