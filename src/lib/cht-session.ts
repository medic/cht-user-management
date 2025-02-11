import _ from 'lodash';
const axios = require('axios'); // require is needed for rewire
import { AxiosHeaders, AxiosInstance } from 'axios';
import axiosRetry from 'axios-retry';
import * as semver from 'semver';

import { AuthErrors } from './authentication/errors/authentication-error';
import { AuthenticationInfo } from '../config';
import { axiosRetryConfig } from './retry-logic';
import { RemotePlace } from './remote-place-cache';

const COUCH_AUTH_COOKIE_NAME = 'AuthSession=';
const ADMIN_FACILITY_ID = '*';
const ADMIN_ROLES = ['admin', '_admin'];

axiosRetry(axios, axiosRetryConfig);

type SessionCreationDetails = {
  authInfo: AuthenticationInfo;
  username: string;
  sessionToken: string;
  facilityIds: string[];
  chtCoreVersion: string;
};

export default class ChtSession {
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
    
    this.axiosInstance = axios.create({
      baseURL: ChtSession.createUrl(creationDetails.authInfo, ''),
      headers: { Cookie: creationDetails.sessionToken },
    });
    axiosRetry(this.axiosInstance, axiosRetryConfig);
    if (!this.sessionToken || !this.authInfo.domain || !this.username || this.facilityIds.length === 0) {
      throw new Error('invalid CHT session information');
    }
  }

  public get isAdmin(): boolean {
    return this.facilityIds.includes(ADMIN_FACILITY_ID);
  }

  public static async create(authInfo: AuthenticationInfo, username: string, password: string): Promise<ChtSession> {
    try {
      const sessionToken = await ChtSession.createSessionToken(authInfo, username, password);
      if (!sessionToken) {
        throw new Error(`failed to obtain token for ${username} at ${authInfo.domain}`);
      }

      const creationDetails = await ChtSession.fetchCreationDetails(authInfo, username, sessionToken);
      return new ChtSession(creationDetails);
    } catch (e: any) {
      if (e.response?.status === 401) {
        throw AuthErrors.INVALID_CREDENTIALS();
      }
      throw e;
    }
  }

  public static createFromDataString(data: string): ChtSession {
    const parsed: any = JSON.parse(data);
    return new ChtSession(parsed);
  }

  isPlaceAuthorized(remotePlace: RemotePlace): boolean {
    return this.facilityIds?.length > 0 &&
      (
        this.isAdmin
        || _.intersection(remotePlace?.lineage, this.facilityIds).length > 0
        || this.facilityIds.includes(remotePlace?.id)
      );
  }

  private static async createSessionToken(authInfo: AuthenticationInfo, username: string, password: string): Promise<string> {
    const sessionUrl = ChtSession.createUrl(authInfo, '_session');
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
    return setCookieHeader?.[0]?.split(';')
      .find((header: string) => header.startsWith(COUCH_AUTH_COOKIE_NAME));
  }
  
  private static async fetchCreationDetails(authInfo: AuthenticationInfo, username: string, sessionToken: string): Promise<SessionCreationDetails> {
    // api/v2/users returns all users prior to 4.6 even with ?facility_id
    const paths = [`medic/org.couchdb.user:${username}`, 'api/v2/monitoring'];
    const fetches = paths.map(path => {
      const url = ChtSession.createUrl(authInfo, path);
      return axios.get(
        url,
        { headers: { Cookie: sessionToken } },
      );
    });
    const [
      { data: userDoc }, 
      { data: { version: { app: chtCoreVersion } } }
    ] = await Promise.all(fetches);

    const isAdmin = _.intersection(ADMIN_ROLES, userDoc?.roles).length > 0;

    const facilityIds = isAdmin ? [ADMIN_FACILITY_ID] : _.flatten([userDoc?.facility_id]).filter(Boolean);
    if (!facilityIds?.length) {
      throw Error(`User ${username} does not have a facility_id connected to their user doc`);
    }

    ChtSession.assertCoreVersion(chtCoreVersion, authInfo.domain);

    return {
      authInfo,
      username,
      sessionToken,
      chtCoreVersion,
      facilityIds,
    };
  }
  
  private static assertCoreVersion(chtCoreVersion: any, domain: string) {
    const coercedVersion = semver.valid(semver.coerce(chtCoreVersion));
    if (!coercedVersion) {
      throw Error(`Cannot parse cht core version ${chtCoreVersion} for instance "${domain}"`);
    }

    if (semver.lt(coercedVersion, '4.7.0')) {
      throw Error(`CHT Core Version must be 4.7.0 or higher. "${domain}" is running ${chtCoreVersion}.`);
    }
  }

  private static createUrl(authInfo: AuthenticationInfo, path: string) {
    const protocol = authInfo.useHttp ? 'http' : 'https';
    return `${protocol}://${authInfo.domain}${path ? '/' : ''}${path}`;
  }
}
