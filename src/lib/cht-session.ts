import _ from 'lodash';
const axios = require('axios'); // require is needed for rewire
import * as semver from 'semver';

import { AuthenticationInfo } from '../config';
import { AxiosHeaders, AxiosInstance } from 'axios';
import axiosRetry from 'axios-retry';
import { axiosRetryConfig } from './retry-logic';
import { RemotePlace } from './cht-api';


const COUCH_AUTH_COOKIE_NAME = 'AuthSession=';
const ADMIN_FACILITY_ID = '*';

type SessionCreationDetails = {
  authInfo: AuthenticationInfo;
  username: string;
  sessionToken: string;

  facilityId: string;
  chtCoreVersion: string;
};

axiosRetry(axios, axiosRetryConfig);

export default class ChtSession {
  public readonly authInfo: AuthenticationInfo;
  public readonly username: string;
  public readonly facilityId: string;
  public readonly axiosInstance: AxiosInstance;
  public readonly sessionToken: string;
  public readonly chtCoreVersion: string;

  private constructor(creationDetails: SessionCreationDetails) {
    this.authInfo = creationDetails.authInfo;
    this.username = creationDetails.username;
    this.facilityId = creationDetails.facilityId;
    this.sessionToken = creationDetails.sessionToken;
    this.chtCoreVersion = creationDetails.chtCoreVersion;
    
    this.axiosInstance = axios.create({
      baseURL: ChtSession.createUrl(creationDetails.authInfo, ''),
      headers: { Cookie: creationDetails.sessionToken },
    });
    axiosRetry(this.axiosInstance, axiosRetryConfig);

    if (!this.sessionToken || !this.authInfo.domain || !this.username || !this.facilityId) {
      throw new Error('invalid CHT session information');
    }
  }

  public static async create(authInfo: AuthenticationInfo, username : string, password: string): Promise<ChtSession> {
    const sessionToken = await ChtSession.createSessionToken(authInfo, username, password);

    if (!sessionToken) {
      throw new Error(`failed to obtain token for ${username} at ${authInfo.domain}`);
    }
    
    const creationDetails = await ChtSession.fetchCreationDetails(authInfo, username, sessionToken);
    return new ChtSession(creationDetails);
  }

  public static createFromDataString(data: string): ChtSession {
    const parsed:any = JSON.parse(data);
    return new ChtSession(parsed);
  }

  clone(): ChtSession {
    return new ChtSession(this);
  }

  isPlaceAuthorized(remotePlace: RemotePlace): boolean {
    return !!this.facilityId &&
      (
        this.facilityId === ADMIN_FACILITY_ID 
        || remotePlace?.lineage?.includes(this.facilityId)
        || remotePlace?.id === this.facilityId
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
    // would prefer to use the _users/org.couchdb.user:username doc
    // only admins have access + GET api/v2/users returns all users and cant return just one
    const paths = [`medic/org.couchdb.user:${username}`, 'api/v2/monitoring'];
    const fetches = paths.map(path => {
      const url = ChtSession.createUrl(authInfo, path);
      return axios.get(
        url,
        { headers: { Cookie: sessionToken } },
      );
    });
    const [userResponse, monitoringResponse] = await Promise.all(fetches);

    const adminRoles = ['admin', '_admin'];
    const userDoc = userResponse.data;
    const isAdmin = _.intersection(adminRoles, userDoc?.roles).length > 0;
    const chtCoreVersion = semver.coerce(monitoringResponse.data?.version?.app)?.version;

    const facilityId = isAdmin ? ADMIN_FACILITY_ID : userDoc?.facility_id;
    if (!facilityId) {
      throw Error(`User ${username} does not have a facility_id connected to their user doc`);
    }

    if (!chtCoreVersion) {
      throw Error(`Cannot parse cht core version for instance "${authInfo.domain}"`);
    }

    return {
      authInfo,
      username,
      sessionToken,
      chtCoreVersion,
      facilityId,
    };
  }
  
  private static createUrl(authInfo: AuthenticationInfo, path: string) {
    const protocol = authInfo.useHttp ? 'http' : 'https';
    return `${protocol}://${authInfo.domain}${path ? '/' : ''}${path}`;
  }
}
