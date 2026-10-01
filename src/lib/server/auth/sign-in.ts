import { json, type Cookies } from '@sveltejs/kit';
import { z } from 'zod';

import { setSessionCookie } from '../http';
import type { Settings } from '../settings';
import { authError } from './errors';
import { findInstance, type Instance } from './instances';
import { describeSession, type Session } from './session';
import { issueToken } from './tokens';

export const deliverSchema = z.enum(['cookie', 'token']).default('cookie');
export type Deliver = z.infer<typeof deliverSchema>;

export function requireInstance(settings: Settings, id: string): Instance {
  const instance = findInstance(settings.instances, id);
  if (!instance) {
    throw authError('UNKNOWN_INSTANCE', `unrecognized instance "${id}"`);
  }
  return instance;
}

// Browsers get an HttpOnly cookie and never see the token; machine clients get the token instead
export async function completeSignIn(
  cookies: Cookies,
  settings: Settings,
  instance: Instance,
  session: Session,
  deliver: Deliver
): Promise<Response> {
  const { token, jti, expiresAt } = await issueToken('session', session, settings.cookieKey, settings.sessionTtlSeconds);
  const described = describeSession({ session, instance, jti, expiresAt });

  if (deliver === 'cookie') {
    setSessionCookie(cookies, token, settings.sessionTtlSeconds);
    return json(described);
  }
  return json({ token, expiresAt: expiresAt.toISOString(), session: described });
}
