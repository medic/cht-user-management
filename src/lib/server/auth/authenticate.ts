import { authError } from './errors';
import type { Instance } from './instances';
import type { RevocationList } from './revocation';
import { instanceFor, type Authenticated } from './session';
import { readToken } from './tokens';

export type AuthenticateOptions = {
	cookieKey: string;
	revocations: RevocationList;
	instances: Instance[];
	now?: Date;
};

// APP.md → Carrying the session between requests, step 2
export async function authenticate(token: string, options: AuthenticateOptions): Promise<Authenticated> {
	const { session, jti, expiresAt } = await readToken('session', token, options.cookieKey, options.now);
	if (await options.revocations.isRevoked(jti)) {
		throw authError('UNAUTHENTICATED', 'this session has been signed out');
	}
	return { session, instance: instanceFor(options.instances, session), jti, expiresAt };
}
