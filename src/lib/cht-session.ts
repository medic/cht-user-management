import _ from 'lodash';
const axios = require('axios'); // require is needed for rewire

import { AuthenticationInfo } from '../config';
import { AxiosHeaders, AxiosInstance } from 'axios';
import axiosRetry from 'axios-retry';
import { axiosRetryConfig } from './retry-logic';
import { RemotePlace } from './remote-place-cache';

const COUCH_AUTH_COOKIE_NAME = 'AuthSession=';
const ADMIN_FACILITY_ID = '*';

axiosRetry(axios, axiosRetryConfig);

export default class ChtSession {
  public readonly authInfo: AuthenticationInfo;
  public readonly username: string;
  public readonly facilityIds: string[];
  public readonly axiosInstance: AxiosInstance;
  public readonly sessionToken: string;

  private constructor(authInfo: AuthenticationInfo, sessionToken: string, username: string, facilityIds: string[]) {
    this.authInfo = authInfo;
    this.username = username;
    this.facilityIds = facilityIds;
    this.sessionToken = sessionToken;
    
    this.axiosInstance = axios.create({
      baseURL: ChtSession.createUrl(authInfo, ''),
      headers: { Cookie: sessionToken },
    });
    axiosRetry(this.axiosInstance, axiosRetryConfig);
    if (!this.sessionToken || !this.authInfo.domain || !this.username || this.facilityIds.length === 0) {
      throw new Error('invalid CHT session information');
    }
  }

  public get isAdmin(): boolean {
    return this.facilityIds.includes(ADMIN_FACILITY_ID);
  }

  public static async create(authInfo: AuthenticationInfo, username : string, password: string): Promise<ChtSession> {
    const sessionToken = await ChtSession.createSessionToken(authInfo, username, password);

    if (!sessionToken) {
      throw new Error(`failed to obtain token for ${username} at ${authInfo.domain}`);
    }
    
    const userDetails = await ChtSession.fetchUserDetails(authInfo, username, sessionToken);
    const facilityIds = userDetails.isAdmin ? [ADMIN_FACILITY_ID] : userDetails.facilityId;
    if (!facilityIds || facilityIds?.length === 0) {
      throw Error(`User ${username} does not have a facility_id connected to their user doc`);
    }
    
    return new ChtSession(authInfo, sessionToken, username, facilityIds);
  }

  public static createFromDataString(data: string): ChtSession {
    const parsed: { 
      authInfo: AuthenticationInfo;
      sessionToken: string;
      username: string;
      facilityIds: string[]; 
    } = JSON.parse(data);
    return new ChtSession(parsed.authInfo, parsed.sessionToken, parsed.username, parsed.facilityIds);
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
  
  private static async fetchUserDetails(authInfo: AuthenticationInfo, username: string, sessionToken: string): 
  Promise<{isAdmin: boolean; facilityId?: string[]}> {
    // would prefer to use the _users/org.couchdb.user:username doc
    // only admins have access + GET api/v2/users returns all users and cant return just one
    const sessionUrl = ChtSession.createUrl(authInfo, `medic/org.couchdb.user:${username}`);
    const resp = await axios.get(
      sessionUrl,
      {
        headers: { Cookie: sessionToken },
      },
    );
  
    const adminRoles = ['admin', '_admin'];
    const isAdmin = _.intersection(adminRoles, resp.data?.roles).length > 0;
    let facilityId;
    if (typeof resp.data?.facility_id === 'string') {
      facilityId = [resp.data.facility_id];
    } else if (Array.isArray(resp.data?.facility_id)) {
      facilityId = resp.data.facility_id;
    }
    return { isAdmin, facilityId };
  }
  
  private static createUrl(authInfo: AuthenticationInfo, path: string) {
    const protocol = authInfo.useHttp ? 'http' : 'https';
    return `${protocol}://${authInfo.domain}${path ? '/' : ''}${path}`;
  }
}
