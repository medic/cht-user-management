import type { Instance } from '../auth/instances';
import { authError } from '../auth/errors';
import type { Settings } from '../settings';

// The cookie the previous version's clients send their token back in, eg. `Cookie: AuthToken=…`
export const LEGACY_AUTH_COOKIE = 'AuthToken';

// /api/v1 endpoints anyone may call
export const LEGACY_PUBLIC_PATHS = new Set(['/api/v1/sso-login']);

// The previous version named instances by their display name ("domain": "Migori"), which is each
// instance's `name` now. Its local development instance was "$Development"
export function legacyInstance(settings: Settings, domain: unknown): Instance {
  const instance = settings.instances.find(
    (candidate) => candidate.name === domain || (domain === '$Development' && candidate.id === 'dev')
  );
  if (!instance) {
    throw authError('UNKNOWN_INSTANCE', `unrecognized domain: "${domain}"`);
  }
  return instance;
}
