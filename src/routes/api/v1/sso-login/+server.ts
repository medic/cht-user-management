import { json } from '@sveltejs/kit';

import { loginWithSso } from '$lib/server/auth/cht-login';
import { issueToken } from '$lib/server/auth/tokens';
import { LEGACY_AUTH_COOKIE, legacyInstance } from '$lib/server/legacy/auth';
import { ensureJsonObjectBody, legacyHandler, readLegacyBody } from '$lib/server/legacy/http';
import { getSettings } from '$lib/server/settings';

// POST /api/v1/sso-login { domain, access_token }: the previous version's SSO sign-in. The token comes
// back as `AuthToken`, for the client to send back as the AuthToken cookie (or as a bearer token)
export const POST = legacyHandler(async ({ request }) => {
  const body = await readLegacyBody(request);
  ensureJsonObjectBody(body);

  const settings = getSettings();
  const instance = legacyInstance(settings, body.domain);
  const accessToken = typeof body.access_token === 'string' ? body.access_token : '';
  if (!accessToken) {
    throw new Error('Missing access token');
  }
  if (!instance.idpOrigins.length) {
    throw new Error('SSO is not configured: idpOrigins allowlist is empty');
  }

  // a failure is a 500 with its message, as before
  const session = await loginWithSso(instance, accessToken, { fetch, allowAdminLogin: settings.allowAdminLogin });
  const { token } = await issueToken('session', session, settings.cookieKey, settings.sessionTtlSeconds);
  return json({ ok: true, [LEGACY_AUTH_COOKIE]: token });
});
