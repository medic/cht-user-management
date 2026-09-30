import { hkdfSync, randomUUID } from 'node:crypto';
import { EncryptJWT, jwtDecrypt } from 'jose';

import { authError } from './errors';
import { sessionSchema, type Session } from './session';

// Session tokens go to browsers and API clients; job tokens stay with background jobs. They're keyed
// from different secrets and derived for their purpose, so neither can be used as the other.
export type TokenPurpose = 'session' | 'job';

export type IssuedToken = { token: string; jti: string; expiresAt: Date };
export type ReadToken = { session: Session; jti: string; expiresAt: Date };

function keyFor(secret: string, purpose: TokenPurpose): Uint8Array {
  return new Uint8Array(hkdfSync('sha256', secret, 'cht-iam', `token:${purpose}`, 32));
}

// Encrypted (JWE, dir + A256GCM), which also authenticates it: the CouchDB session inside can't be
// read or altered by whoever holds the token
export async function issueToken(
  purpose: TokenPurpose,
  session: Session,
  secret: string,
  ttlSeconds: number,
  now: Date = new Date()
): Promise<IssuedToken> {
  const jti = randomUUID();
  const issuedAt = Math.floor(now.getTime() / 1000);
  const expiresAt = issuedAt + ttlSeconds;
  const token = await new EncryptJWT({ session })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setAudience(`cht-iam:${purpose}`)
    .setJti(jti)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .encrypt(keyFor(secret, purpose));
  return { token, jti, expiresAt: new Date(expiresAt * 1000) };
}

export async function readToken(purpose: TokenPurpose, token: string, secret: string, now: Date = new Date()): Promise<ReadToken> {
  let payload;
  try {
    ({ payload } = await jwtDecrypt(token, keyFor(secret, purpose), { audience: `cht-iam:${purpose}`, currentDate: now }));
  } catch {
    throw authError('UNAUTHENTICATED', 'invalid or expired token');
  }

  const session = sessionSchema.safeParse(payload.session);
  if (!session.success || !payload.jti || !payload.exp) {
    throw authError('UNAUTHENTICATED', 'token does not contain a session');
  }
  return { session: session.data, jti: payload.jti, expiresAt: new Date(payload.exp * 1000) };
}
