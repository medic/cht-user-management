import crypto from 'crypto';
import process from 'process';
import jwt from 'jsonwebtoken';
import ChtSession from './cht-session';

const LOGIN_EXPIRES_AFTER_MS = 4 * 24 * 60 * 60 * 1000;
const QUEUE_SESSION_EXPIRATION = '96h';
const { COOKIE_PRIVATE_KEY, WORKER_PRIVATE_KEY, SECRET_KEY } = process.env;
const PRIVATE_KEY_SALT = '$'; // change to logout all users
const COOKIE_SIGNING_KEY = COOKIE_PRIVATE_KEY + PRIVATE_KEY_SALT;

// Worker tokens are stored in Redis job data, so they are encrypted as well as signed
const WORKER_TOKEN_PREFIX = 'enc.v1.';
const WORKER_CIPHER = 'aes-256-gcm';
const WORKER_IV_BYTES = 12;
const WORKER_AUTH_TAG_BYTES = 16;

export default class Auth {
  public static AUTH_COOKIE_NAME = 'AuthToken';

  public static assertEnvironmentSetup() {
    if (!COOKIE_PRIVATE_KEY) {
      throw new Error('.env missing COOKIE_PRIVATE_KEY');
    }
    if (!WORKER_PRIVATE_KEY) {
      throw new Error('.env missing WORKER_PRIVATE_KEY');
    }
    if (COOKIE_PRIVATE_KEY === WORKER_PRIVATE_KEY) {
      throw new Error('COOKIE_PRIVATE_KEY should be different from WORKER_PRIVATE_KEY');
    }
    if (!SECRET_KEY) {
      throw new Error('.env missing SECRET_KEY');
    }
  }

  public static encodeTokenForCookie(session: ChtSession) {
    return this.encodeToken(session, COOKIE_SIGNING_KEY, '1 day');
  }

  public static createCookieSession(token: string): ChtSession {
    return this.createSessionFromToken(token, COOKIE_SIGNING_KEY);
  }

  public static encodeTokenForWorker(session: ChtSession) {
    const signed = this.encodeToken(session, `${WORKER_PRIVATE_KEY}`, QUEUE_SESSION_EXPIRATION);
    return this.encryptForWorker(signed);
  }

  public static createWorkerSession(token: string): ChtSession {
    // tokens queued before encryption was introduced are plain signed JWTs
    const signed = token?.startsWith(WORKER_TOKEN_PREFIX) ? this.decryptForWorker(token) : token;
    return this.createSessionFromToken(signed, `${WORKER_PRIVATE_KEY}`);
  }

  public static cookieExpiry() {
    return new Date(new Date().getTime() + LOGIN_EXPIRES_AFTER_MS);
  }


  private static encodeToken(session: ChtSession, signingKey: string, expiresIn: jwt.SignOptions['expiresIn']): string {
    const data = JSON.stringify(session);
    return jwt.sign({ data }, signingKey, { expiresIn });
  }

  private static workerEncryptionKey(): Buffer {
    return crypto.createHash('sha256').update(`worker-token-encryption:${WORKER_PRIVATE_KEY}`).digest();
  }

  private static encryptForWorker(plaintext: string): string {
    const iv = crypto.randomBytes(WORKER_IV_BYTES);
    const cipher = crypto.createCipheriv(WORKER_CIPHER, this.workerEncryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return WORKER_TOKEN_PREFIX + Buffer.concat([iv, authTag, encrypted]).toString('base64url');
  }

  private static decryptForWorker(token: string): string {
    const raw = Buffer.from(token.slice(WORKER_TOKEN_PREFIX.length), 'base64url');
    if (raw.length <= WORKER_IV_BYTES + WORKER_AUTH_TAG_BYTES) {
      throw new Error('invalid worker token');
    }

    const iv = raw.subarray(0, WORKER_IV_BYTES);
    const authTag = raw.subarray(WORKER_IV_BYTES, WORKER_IV_BYTES + WORKER_AUTH_TAG_BYTES);
    const encrypted = raw.subarray(WORKER_IV_BYTES + WORKER_AUTH_TAG_BYTES);
    try {
      const decipher = crypto.createDecipheriv(WORKER_CIPHER, this.workerEncryptionKey(), iv);
      decipher.setAuthTag(authTag);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    } catch {
      throw new Error('invalid worker token');
    }
  }

  private static createSessionFromToken(token: string, signingKey: string): ChtSession {
    if (!token) {
      throw new Error('invalid authentication token');
    }

    const { data } = jwt.verify(token, signingKey) as any;
    return ChtSession.createFromDataString(data);
  }
}
