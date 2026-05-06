import process from 'process';
const axios = require('axios'); // require is needed for rewire
import { AxiosHeaders, AxiosInstance } from 'axios';

import { AuthError } from '../authentication-error';
import { AuthenticationInfo } from '../../config';
import { RemotePlace } from '../remote-place-cache';
import {
  ADMIN_FACILITY_ID,
  IChtSession,
  buildChtAxiosInstance,
  createChtUrl,
  fetchChtUserMetadata,
  isPlaceAuthorizedFor,
} from './i-cht-session';

const COUCH_AUTH_COOKIE_NAME = 'AuthSession=';
const ALLOW_ADMIN_LOGIN = process.env.ALLOW_ADMIN_LOGIN ?? 'true';

type SessionCreationDetails = {
  authInfo: AuthenticationInfo;
  username: string;
  sessionToken: string;
  facilityIds: string[];
  chtCoreVersion: string;
};

export default class CookieChtSession implements IChtSession {
  public readonly authInfo: AuthenticationInfo;
  public readonly username: string;
  public readonly facilityIds: string[];
  public readonly axiosInstance: AxiosInstance;
  public readonly sessionToken: string;
  public readonly chtCoreVersion: string;

  private constructor(creationDetails: SessionCreationDetails) {
    this.authInfo = creationDetails.authInfo;
    this.username = creationDetails.username;
    this.facilityIds = creationDetails.facilityIds;
    this.sessionToken = creationDetails.sessionToken;
    this.chtCoreVersion = creationDetails.chtCoreVersion;

    this.axiosInstance = buildChtAxiosInstance(creationDetails.authInfo, {
      Cookie: creationDetails.sessionToken,
    });
    if (!this.sessionToken || !this.authInfo.domain || !this.username || this.facilityIds.length === 0) {
      throw new Error('invalid CHT session information');
    }
  }

  public get isAdmin(): boolean {
    return this.facilityIds.includes(ADMIN_FACILITY_ID);
  }

  public get cacheKey(): string {
    return this.sessionToken;
  }

  public isPlaceAuthorized(remotePlace: RemotePlace): boolean {
    return isPlaceAuthorizedFor(this.facilityIds, remotePlace);
  }

  public static async create(authInfo: AuthenticationInfo, username: string, password: string): Promise<CookieChtSession> {
    const sessionToken = await CookieChtSession.createSessionToken(authInfo, username, password);
    const { facilityIds, chtCoreVersion } = await fetchChtUserMetadata(
      authInfo,
      username,
      { headers: { Cookie: sessionToken } },
      { allowAdmin: ALLOW_ADMIN_LOGIN !== 'false' },
    );
    return new CookieChtSession({ authInfo, username, sessionToken, facilityIds, chtCoreVersion });
  }

  public static createFromDataString(data: string): CookieChtSession {
    const parsed: any = JSON.parse(data);
    return new CookieChtSession(parsed);
  }

  private static async createSessionToken(authInfo: AuthenticationInfo, username: string, password: string): Promise<string> {
    try {
      const sessionUrl = createChtUrl(authInfo, '_session');
      const resp = await axios.post(
        sessionUrl,
        {
          name: username,
          password,
        },
        {
          auth: {
            username,
            password
          },
        }
      );
      const setCookieHeader = (resp.headers as AxiosHeaders).get('set-cookie') as AxiosHeaders;
      const token = setCookieHeader?.[0]?.split(';')
        .find((header: string) => header.startsWith(COUCH_AUTH_COOKIE_NAME));
      if (!token) {
        throw AuthError.TOKEN_CREATION_FAILED(username, authInfo.domain);
      }
      return token;
    } catch (e: any) {
      if (e?.response?.status === 401) {
        throw AuthError.INVALID_CREDENTIALS();
      }
      if (e.code === 'ENOTFOUND' || e.errno === -3008) {
        throw AuthError.INSTANCE_OFFLINE();
      }
      if (e.code === 'ETIMEDOUT' || e?.cause?.code === 'ETIMEDOUT' || e?.cause?.code === 'ECONNREFUSED') {
        throw AuthError.CONNECTION_TIMEOUT(authInfo.domain);
      }
      throw e;
    }
  }
}
