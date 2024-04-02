import process from 'process';
import jwt from 'jsonwebtoken';
import ChtSession from './cht-session';

const LOGIN_EXPIRES_AFTER_MS = 2 * 24 * 60 * 60 * 1000;
const { COOKIE_PRIVATE_KEY } = process.env;
const PRIVATE_KEY_SALT = '2'; // change to logout all users
const SIGNING_KEY = COOKIE_PRIVATE_KEY + PRIVATE_KEY_SALT;

export default class Auth {
  public static AUTH_COOKIE_NAME = 'AuthToken';

  public static assertEnvironmentSetup() {
    if (!COOKIE_PRIVATE_KEY) {
      throw new Error('.env missing COOKIE_PRIVATE_KEY');
    }
  }

  public static encodeToken (session: ChtSession) {
    const data = JSON.stringify(session);
    return jwt.sign({ data }, SIGNING_KEY, { expiresIn: '1 day' });
  }

  public static cookieExpiry() {
    return new Date(new Date().getTime() + LOGIN_EXPIRES_AFTER_MS);
  }

  public static decodeToken (token: string) : ChtSession {
    if (!token) {
      throw new Error('invalid authentication token');
    }

    const { data } = jwt.verify(token, SIGNING_KEY) as any;
    return ChtSession.createFromDataString(data);
  }
}
