import { z } from 'zod';

import { ApiError } from '../errors';
import { authError } from './errors';
import { baseUrl, findInstance, type Instance } from './instances';

// The session record from APP.md → Auth → The session, and nothing else
export type Session = {
  instanceId: string;
  username: string;
  // CouchDB's "AuthSession=<value>" cookie: the credential sent on every CHT call. Never leaves the server
  sessionCookie: string;
  // the places the user manages, or ["*"] for an admin
  facilityIds: string[];
  chtVersion: string;
  isAdmin: boolean;
};

export const sessionSchema = z
  .object({
    instanceId: z.string().min(1),
    username: z.string().min(1),
    sessionCookie: z.string().regex(/^AuthSession=.+/),
    facilityIds: z.array(z.string().min(1)).min(1),
    chtVersion: z.string().min(1),
    isAdmin: z.boolean()
  })
  .strict();

// An authenticated request: the session, the instance it's for, and the token that carried it
export type Authenticated = {
  session: Session;
  instance: Instance;
  jti: string;
  expiresAt: Date;
};

export const SESSION_COOKIE = 'cht_iam_session';
const ADMIN_FACILITY_ID = '*';

// The bearer header wins over the cookie, so a machine client is never confused by a stray cookie
export function presentedToken(authorization: string | null, cookie: string | undefined): string | undefined {
  return authorization?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? cookie;
}

export function instanceFor(instances: Instance[], session: Session): Instance {
  const instance = findInstance(instances, session.instanceId);
  if (!instance) {
    throw authError('UNAUTHENTICATED', 'the instance of this session is no longer configured');
  }
  return instance;
}

// A user may act on a place when it, or one of its ancestors, is one of their facilities
export function assertAuthorized(session: Session, placeAndAncestorIds: string[]): void {
  const allowed = session.facilityIds.includes(ADMIN_FACILITY_ID) || placeAndAncestorIds.some((id) => session.facilityIds.includes(id));
  if (!allowed) {
    throw new ApiError(403, 'FORBIDDEN_PLACE', 'you are not allowed to manage places in this part of the hierarchy');
  }
}

// What GET /auth/session returns: never the CouchDB session cookie
export function describeSession({ session, instance, expiresAt }: Authenticated) {
  return {
    // url: where the CHT app is, for links that open a contact there
    instance: { id: instance.id, name: instance.name, url: baseUrl(instance).replace(/\/$/, '') },
    username: session.username,
    isAdmin: session.isAdmin,
    facilityIds: session.facilityIds,
    chtVersion: session.chtVersion,
    expiresAt: expiresAt.toISOString()
  };
}
