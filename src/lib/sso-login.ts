// Drives the server-to-server OIDC dance against a CHT instance

import axios, { AxiosResponse } from 'axios';
import { AuthenticationInfo } from '../config';
import { COUCH_AUTH_COOKIE_NAME } from './cht-session';

export type SsoLoginResult = { sessionToken: string; username: string };
type CookieJar = Map<string, Map<string, string>>;

/**
 * Drive the OIDC dance and return the resulting CHT session. The access token
 * is forwarded to the IdP unchanged; UMT does not validate or interpret it.
 *
 * - `sessionToken` is the full `AuthSession=<value>` cookie string.
 * - `username` is taken from the `userCtx` cookie CHT sets alongside
 *   `AuthSession` on the callback hop.
 */
export async function ssoLogin(authInfo: AuthenticationInfo, accessToken: string): Promise<SsoLoginResult> {
  const chtBaseUrl = `${authInfo.useHttp ? 'http' : 'https'}://${authInfo.domain}`;
  const start = `${chtBaseUrl}/medic/login/oidc/authorize`;
  const { jar, finalUrl } = await follow(start, accessToken);

  // CHT may redirect across hostnames mid-chain (e.g. localhost <-> LAN IP).
  // Pick whichever bucket actually carries the session cookie.
  const bucket = findBucketWith(jar, COUCH_AUTH_COOKIE_NAME);
  const sessionValue = bucket?.get(COUCH_AUTH_COOKIE_NAME);
  if (!sessionValue) {
    throw new Error(`SSO dance completed at ${finalUrl} but no ${COUCH_AUTH_COOKIE_NAME} cookie was set in any bucket`);
  }

  const username = getUsername(bucket, finalUrl, authInfo.domain);
  return { sessionToken: `${COUCH_AUTH_COOKIE_NAME}=${sessionValue}`, username };
}

function findBucketWith(jar: CookieJar, cookieName: string): Map<string, string> | undefined {
  for (const bucket of Array.from(jar.values())) {
    if (bucket.has(cookieName)) {
      return bucket;
    }
  }
  return undefined;
}

function storeCookies(jar: CookieJar, host: string, setCookie: string[] | undefined): void {
  if (!setCookie?.length) {
    return;
  }
  let bucket = jar.get(host);
  if (!bucket) {
    bucket = new Map();
    jar.set(host, bucket);
  }
  for (const c of setCookie) {
    const [pair] = c.split(';');
    const eq = pair.indexOf('=');
    if (eq < 0) {
      continue;
    }
    bucket.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

function serializeCookies(jar: CookieJar, host: string): string {
  const bucket = jar.get(host);
  if (!bucket) {
    return '';
  }
  return Array.from(bucket.entries()).map(([n, v]) => `${n}=${v}`).join('; ');
}

async function follow(start: string, accessToken: string, maxHops = 12): Promise<{ jar: CookieJar; finalUrl: string }> {
  const jar: CookieJar = new Map();
  let current = start;
  for (let hop = 0; hop < maxHops; hop++) {
    const url = new URL(current);
    const cookies = serializeCookies(jar, url.host);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      Accept: '*/*',
      'User-Agent': 'cht-user-management/sso-login',
    };
    if (cookies) {
      headers.Cookie = cookies;
    }

    const res: AxiosResponse<string> = await axios.request({
      method: 'GET',
      url: current,
      headers,
      maxRedirects: 0,
      validateStatus: () => true,
      responseType: 'text',
      transformResponse: x => x,
    });

    storeCookies(jar, url.host, res.headers['set-cookie']);

    if (res.status >= 300 && res.status < 400) {
      let loc = res.headers.location as string | undefined;
      // CHT 5.1.2 emits 302 with the redirect URL in the body, not the Location header.
      const body = typeof res.data === 'string' ? res.data : '';
      if (!loc && /^https?:\/\//.test(body.trim())) {
        loc = body.trim();
      }
      if (loc) {
        current = loc.startsWith('http') ? loc : new URL(loc, current).toString();
        continue;
      }
    }
    if (res.status >= 200 && res.status < 300) {
      return { jar, finalUrl: current };
    }
    const errBody = typeof res.data === 'string' ? res.data.slice(0, 200) : '';
    throw new Error(`SSO dance failed at ${current}: HTTP ${res.status} ${errBody}`);
  }
  throw new Error(`SSO dance exceeded ${maxHops} hops`);
}

function getUsername(bucket: Map<string, string> | undefined, finalUrl: string, chtHost: string): string {
  const userCtxRaw = bucket?.get('userCtx');
  if (!userCtxRaw) {
    throw new Error(`SSO dance completed at ${finalUrl} but no userCtx cookie was set for ${chtHost}`);
  }

  let username: string | undefined;
  try {
    username = JSON.parse(decodeURIComponent(userCtxRaw))?.name;
  } catch {
    // fall through to the missing-name check below
  }

  if (!username) {
    throw new Error(`SSO dance: userCtx cookie has no usable name claim`);
  }
  return username;
}
