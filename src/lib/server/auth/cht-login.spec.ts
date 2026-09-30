import { afterEach, describe, expect, it } from 'vitest';

import { ApiError } from '../errors';
import { allPermissions, startFakeCht, startSilentServer, type FakeCht } from '../testing/fake-cht-server';
import { loginWithPassword, loginWithSso, MIN_CHT_VERSION, REQUIRED_PERMISSIONS, type LoginOptions } from './cht-login';

const options: LoginOptions = { fetch, allowAdminLogin: true };
const manager = allPermissions('chu_manager', REQUIRED_PERMISSIONS);

let cht: FakeCht | undefined;
afterEach(async () => {
  await cht?.close();
  cht = undefined;
});

async function expectAuthError(promise: Promise<unknown>, code: string): Promise<ApiError> {
  const error = await promise.then(
    () => undefined,
    (e) => e
  );
  expect(error).toBeInstanceOf(ApiError);
  expect(error.code).toBe(code);
  return error;
}

describe('loginWithPassword', () => {
  it('opens a CouchDB session and admits a user with every permission', async () => {
    cht = await startFakeCht({ permissions: manager });

    const session = await loginWithPassword(cht.instance, 'alice', 'secret', options);

    expect(session).toEqual({
      instanceId: 'test',
      username: 'alice',
      sessionCookie: 'AuthSession=abc123',
      facilityIds: ['sub-1'],
      chtVersion: '4.18.0',
      isAdmin: false
    });
  });

  it('reports wrong and missing credentials', async () => {
    cht = await startFakeCht({ permissions: manager });
    await expectAuthError(loginWithPassword(cht.instance, 'alice', 'wrong', options), 'INVALID_CREDENTIALS');
    await expectAuthError(loginWithPassword(cht.instance, '', 'secret', options), 'MISSING_CREDENTIALS');
  });

  it('fails when CHT answers without a session cookie', async () => {
    cht = await startFakeCht({ permissions: manager, setSessionCookie: false });
    await expectAuthError(loginWithPassword(cht.instance, 'alice', 'secret', options), 'NO_SESSION_COOKIE');
  });

  it('says when the scheme is wrong, instead of a vague session failure', async () => {
    cht = await startFakeCht({
      permissions: manager,
      sessionOverride: { status: 400, body: '<title>400 Bad Request - The plain HTTP request was sent to HTTPS port</title>' }
    });
    const plainToTls = await expectAuthError(loginWithPassword(cht.instance, 'alice', 'secret', options), 'NO_SESSION_COOKIE');
    expect(plainToTls.message).toMatch(/expects https, but was reached over http/);

    cht.state.sessionOverride = { status: 301, location: 'https://cht.example.org/_session' };
    const redirected = await expectAuthError(loginWithPassword(cht.instance, 'alice', 'secret', options), 'NO_SESSION_COOKIE');
    expect(redirected.message).toMatch(/redirected the login to https:\/\/cht.example.org\/_session/);
    expect(redirected.details).toMatchObject({ status: 301, scheme: 'http' });
  });

  it('refuses users missing a required permission, without saying which', async () => {
    const { can_delete_users: _dropped, ...rest } = manager;
    cht = await startFakeCht({ permissions: rest });

    const error = await expectAuthError(loginWithPassword(cht.instance, 'alice', 'secret', options), 'MISSING_PERMISSIONS');
    expect(error.message).not.toContain('can_delete_users');
    expect(error.status).toBe(403);
  });

  it('admits admins without the permission check, across every facility', async () => {
    cht = await startFakeCht({ userSettings: { roles: ['_admin'] } });

    const session = await loginWithPassword(cht.instance, 'alice', 'secret', options);

    expect(session).toMatchObject({ isAdmin: true, facilityIds: ['*'] });
  });

  it('turns admins away when admin login is disabled', async () => {
    cht = await startFakeCht({ userSettings: { roles: ['admin'] } });
    await expectAuthError(
      loginWithPassword(cht.instance, 'alice', 'secret', { ...options, allowAdminLogin: false }),
      'ADMIN_LOGIN_DISABLED'
    );
  });

  it('accepts a facility list, and refuses users with no facility', async () => {
    cht = await startFakeCht({ permissions: manager, userSettings: { roles: ['chu_manager'], facility_id: ['sub-1', 'sub-2'] } });
    expect((await loginWithPassword(cht.instance, 'alice', 'secret', options)).facilityIds).toEqual(['sub-1', 'sub-2']);

    cht.state.userSettings = { roles: ['chu_manager'] };
    await expectAuthError(loginWithPassword(cht.instance, 'alice', 'secret', options), 'NO_FACILITY');
  });

  it('uses one minimum version for the check and the message', async () => {
    cht = await startFakeCht({ permissions: manager, version: '4.7.2' });

    const error = await expectAuthError(loginWithPassword(cht.instance, 'alice', 'secret', options), 'UNSUPPORTED_CHT_VERSION');
    expect(error.message).toContain(MIN_CHT_VERSION);
    expect(error.details).toEqual({ actual: '4.7.2', minimum: MIN_CHT_VERSION });

    cht.state.version = '4.10.0-beta.1';
    expect((await loginWithPassword(cht.instance, 'alice', 'secret', options)).chtVersion).toBe('4.10.0');

    cht.state.version = 'unknown';
    await expectAuthError(loginWithPassword(cht.instance, 'alice', 'secret', options), 'UNSUPPORTED_CHT_VERSION');
  });

  it('reports an instance that refuses connections or never answers', async () => {
    const refused = { id: 'x', name: 'Gone', host: '127.0.0.1:1', useHttp: true, idpOrigins: [] };
    const error = await expectAuthError(loginWithPassword(refused, 'alice', 'secret', options), 'INSTANCE_UNREACHABLE');
    expect(error.status).toBe(504);

    const silent = await startSilentServer();
    try {
      const slow = { id: 'y', name: 'Slow', host: silent.host, useHttp: true, idpOrigins: [] };
      const timeout = await expectAuthError(
        loginWithPassword(slow, 'alice', 'secret', { ...options, timeoutMs: 200 }),
        'INSTANCE_UNREACHABLE'
      );
      expect(timeout.details?.reason).toBe('timeout');
    } finally {
      await silent.close();
    }
  });
});

describe('loginWithSso', () => {
  it('follows the OIDC redirects and sends the access token only to the identity provider', async () => {
    cht = await startFakeCht({ permissions: manager });

    const session = await loginWithSso(cht.instance, 'idp-token', options);

    expect(session).toMatchObject({ username: 'alice', sessionCookie: 'AuthSession=abc123' });
    expect(cht.state.authorizationSeenByCht).toEqual([]);
  });

  it('follows a redirect sent in the body, as some CHT versions do', async () => {
    cht = await startFakeCht({ permissions: manager, redirectInBody: true });
    expect((await loginWithSso(cht.instance, 'idp-token', options)).username).toBe('alice');
  });

  it('fails when the identity provider rejects the token', async () => {
    cht = await startFakeCht({ permissions: manager });
    const error = await expectAuthError(loginWithSso(cht.instance, 'wrong-token', options), 'SSO_FAILED');
    expect(error.message).not.toContain('wrong-token');
  });

  it('fails when CHT sets no userCtx cookie', async () => {
    cht = await startFakeCht({ permissions: manager, setUserCtx: false });
    await expectAuthError(loginWithSso(cht.instance, 'idp-token', options), 'SSO_FAILED');
  });

  it('is disabled without allowlisted identity providers, and never sends the token then', async () => {
    cht = await startFakeCht({ permissions: manager });
    await expectAuthError(loginWithSso({ ...cht.instance, idpOrigins: [] }, 'idp-token', options), 'SSO_DISABLED');
    await expectAuthError(loginWithSso(cht.instance, '', options), 'MISSING_CREDENTIALS');
  });

  it('does not send the token to an identity provider that is not allowlisted', async () => {
    cht = await startFakeCht({ permissions: manager });
    const otherOrigin = { ...cht.instance, idpOrigins: ['https://idp.example.org'] };

    // the real provider never receives the token, so it rejects the request
    await expectAuthError(loginWithSso(otherOrigin, 'idp-token', options), 'SSO_FAILED');
  });
});
