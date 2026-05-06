import { FastifyRequest } from 'fastify';

import { Config } from '../../config';
import Auth from '../authentication';
import CookieChtSession from './cookie-session';
import ProxyChtSession, { extractProxyAuthHeaders } from './proxy-session';
import { IChtSession } from './i-cht-session';

const PROXY_DOMAIN_HEADER = 'x-cht-domain';

export { IChtSession, ADMIN_ROLES, ADMIN_FACILITY_ID } from './i-cht-session';
export { default as CookieChtSession } from './cookie-session';
export {
  default as ProxyChtSession,
  extractProxyAuthHeaders,
  PROXY_USERNAME_HEADER,
  PROXY_ROLES_HEADER,
  PROXY_TOKEN_HEADER,
} from './proxy-session';

// The cookie-based session class is the default export so that existing
// `import ChtSession from '.../cht-session'` paths continue to resolve
// to a working CHT session class.
export { default } from './cookie-session';

export async function createSessionFromRequest(req: FastifyRequest): Promise<IChtSession | null> {
  const proxyHeaders = extractProxyAuthHeaders(req.headers as Record<string, any>);
  if (proxyHeaders) {
    const requestedDomain = req.headers[PROXY_DOMAIN_HEADER] as string | undefined;
    const domain = requestedDomain || Config.getDomains()[0]?.domain;
    if (!domain) {
      throw new Error('proxy auth: no domain configured');
    }
    const authInfo = Config.getAuthenticationInfo(domain);
    return ProxyChtSession.create(authInfo, proxyHeaders);
  }

  const cookieToken = req.cookies[Auth.AUTH_COOKIE_NAME];
  if (cookieToken) {
    return Auth.createCookieSession(cookieToken);
  }

  return null;
}
