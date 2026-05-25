// Drives the server-to-server OIDC dance against a CHT instance

import axios, { AxiosResponse } from 'axios';
import { AuthenticationInfo } from '../config';
import { COUCH_AUTH_COOKIE_NAME } from './cht-session';

const MAX_REDIRECT_HOPS = 12;

export type SsoLoginResult = { sessionToken: string; username: string };
type Cookies = Map<string, string>;

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
  const { chtCookies, finalUrl } = await follow(start, authInfo.domain, accessToken);

  const sessionValue = chtCookies.get(COUCH_AUTH_COOKIE_NAME);
  if (!sessionValue) {
    throw new Error(`SSO dance completed at ${finalUrl} but no ${COUCH_AUTH_COOKIE_NAME} cookie was set for ${authInfo.domain}`);
  }

  const username = getUsername(chtCookies, finalUrl, authInfo.domain);
  return { sessionToken: `${COUCH_AUTH_COOKIE_NAME}=${sessionValue}`, username };
}

function storeCookies(cookies: Cookies, setCookie: string[] | undefined): void {
  if (!setCookie?.length) {
    return;
  }
  for (const c of setCookie) {
    const [pair] = c.split(';');
    const eq = pair.indexOf('=');
    if (eq < 0) {
      continue;
    }
    cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

function serializeCookies(cookies: Cookies): string {
  return Array.from(cookies.entries()).map(([n, v]) => `${n}=${v}`).join('; ');
}

async function follow(start: string, chtHost: string, accessToken: string): Promise<{ chtCookies: Cookies; finalUrl: string }> {
  const chtCookies: Cookies = new Map();
  const idpCookies: Cookies = new Map();
  let current = start;
  for (let hop = 0; hop < MAX_REDIRECT_HOPS; hop++) {
    const url = new URL(current);
    const cookies = url.host === chtHost ? chtCookies : idpCookies;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      Accept: '*/*',
      'User-Agent': 'cht-user-management/sso-login',
    };
    const serialized = serializeCookies(cookies);
    if (serialized) {
      headers.Cookie = serialized;
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

    storeCookies(cookies, res.headers['set-cookie']);

    if (res.status >= 300 && res.status < 400) {
      let loc = res.headers.location as string | undefined;
      // CHT 5.1.2 emits 302 with the redirect URL in the body, not the Location header.
      const body = typeof res.data === 'string' ? res.data : '';
      if (!loc && /^https?:\/\//.test(body.trim())) {
        loc = body.trim();
      }
      if (loc) {
        current = new URL(loc, current).toString();
        continue;
      }
    }
    if (res.status >= 200 && res.status < 300) {
      return { chtCookies, finalUrl: current };
    }
    const errBody = typeof res.data === 'string' ? res.data.slice(0, 200) : '';
    throw new Error(`SSO dance failed at ${current}: HTTP ${res.status} ${errBody}`);
  }

  throw new Error(`SSO dance failed at ${current}: exceeded ${MAX_REDIRECT_HOPS} hops`);
}

function getUsername(chtCookies: Cookies, finalUrl: string, chtHost: string): string {
  const userCtxRaw = chtCookies.get('userCtx');
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
