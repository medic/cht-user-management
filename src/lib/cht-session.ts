import _ from 'lodash';
const axios = require('axios'); // require is needed for rewire
import * as semver from 'semver';

import { AuthenticationInfo } from '../config';
import { AxiosHeaders, AxiosInstance } from 'axios';
import axiosRetry from 'axios-retry';
import { axiosRetryConfig } from './retry-logic';
import { RemotePlace } from './remote-place-cache';


const COUCH_AUTH_COOKIE_NAME = 'AuthSession=';
const ADMIN_FACILITY_ID = '*';

type SessionCreationDetails = {
  authInfo: AuthenticationInfo;
  username: string;
  sessionToken: string;
  facilityIds: string[];
  chtCoreVersion: string;
};

axiosRetry(axios, axiosRetryConfig);

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
    return this.facilityIds?.length > 0 &&
      (
        this.facilityIds.includes(ADMIN_FACILITY_ID) 
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
    // api/v2/users returns all users prior to 4.6
    // only admins have access to _users database after 4.4
    // we don't know what version of cht-core is running, so we do the only thing supported by all versions
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
    const chtCoreVersion = monitoringResponse.data?.version?.app;

    const facilityIds = isAdmin ? [ADMIN_FACILITY_ID] : _.flatten([userDoc?.facility_id]);
    if (!facilityIds?.length) {
      throw Error(`User ${username} does not have a facility_id connected to their user doc`);
    }

    if (!semver.valid(chtCoreVersion)) {
      throw Error(`Cannot parse cht core version for instance "${authInfo.domain}"`);
    }

    return {
      authInfo,
      username,
      sessionToken,
      chtCoreVersion,
      facilityIds,
    };
  }
  
  private static createUrl(authInfo: AuthenticationInfo, path: string) {
    const protocol = authInfo.useHttp ? 'http' : 'https';
    return `${protocol}://${authInfo.domain}${path ? '/' : ''}${path}`;
  }
}
