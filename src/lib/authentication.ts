import { env } from "process";
import jwt from "jsonwebtoken";
import { ChtSession } from "./cht-api";

const LOGIN_EXPIRES_AFTER_MS = 2 * 24 * 60 * 60 * 1000;
const { COOKIE_PRIVATE_KEY } = env;

export default class Auth {
  public static AUTH_COOKIE_NAME = 'AuthToken';

  public static assertEnvironmentSetup() {
    if (!COOKIE_PRIVATE_KEY) {
      throw new Error('.env missing COOKIE_PRIVATE_KEY');
    }
  }

  public static encodeToken (session: ChtSession) {
    return jwt.sign(session, COOKIE_PRIVATE_KEY, { expiresIn: '1 day' });
  }

  public static cookieExpiry() {
    return new Date(new Date().getTime() + LOGIN_EXPIRES_AFTER_MS);
  }

  public static decodeToken (token: string) : ChtSession {
    if (!token) {
      throw new Error('invalid authentication token');
    }

    const session = jwt.verify(token, COOKIE_PRIVATE_KEY) as ChtSession;
    if (!session.sessionToken || !session.authInfo.domain) {
      throw new Error('invalid authentication token');
    }

    return session;
  }
};
