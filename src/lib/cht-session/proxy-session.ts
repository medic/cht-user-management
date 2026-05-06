import { AxiosInstance } from 'axios';

import { AuthenticationInfo } from '../../config';
import { RemotePlace } from '../remote-place-cache';
import {
  ADMIN_FACILITY_ID,
  IChtSession,
  buildChtAxiosInstance,
  fetchChtUserMetadata,
  isPlaceAuthorizedFor,
} from './i-cht-session';

export const PROXY_USERNAME_HEADER = 'x-auth-couchdb-username';
export const PROXY_ROLES_HEADER = 'x-auth-couchdb-roles';
export const PROXY_TOKEN_HEADER = 'x-auth-couchdb-token';

const PROXY_AUTH_HEADER_NAMES = [
  PROXY_USERNAME_HEADER,
  PROXY_ROLES_HEADER,
  PROXY_TOKEN_HEADER,
] as const;

export type ProxyAuthHeaders = Record<string, string>;

export function extractProxyAuthHeaders(
  reqHeaders: Record<string, any>,
): ProxyAuthHeaders | undefined {
  const username = reqHeaders[PROXY_USERNAME_HEADER];
  if (!username) {
    return undefined;
  }

  const headers: ProxyAuthHeaders = {};
  for (const name of PROXY_AUTH_HEADER_NAMES) {
    const value = reqHeaders[name];
    if (typeof value === 'string') {
      headers[name] = value;
    }
  }
  return headers;
}

export default class ProxyChtSession implements IChtSession {
  public readonly authInfo: AuthenticationInfo;
  public readonly username: string;
  public readonly facilityIds: string[];
  public readonly chtCoreVersion: string;
  public readonly axiosInstance: AxiosInstance;

  private constructor(
    authInfo: AuthenticationInfo,
    username: string,
    facilityIds: string[],
    chtCoreVersion: string,
    axiosInstance: AxiosInstance,
  ) {
    this.authInfo = authInfo;
    this.username = username;
    this.facilityIds = facilityIds;
    this.chtCoreVersion = chtCoreVersion;
    this.axiosInstance = axiosInstance;
  }

  public get isAdmin(): boolean {
    return this.facilityIds.includes(ADMIN_FACILITY_ID);
  }

  public get cacheKey(): string {
    return `proxy:${this.username}@${this.authInfo.domain}`;
  }

  public isPlaceAuthorized(remotePlace: RemotePlace): boolean {
    return isPlaceAuthorizedFor(this.facilityIds, remotePlace);
  }

  public static async create(authInfo: AuthenticationInfo, headers: ProxyAuthHeaders): Promise<ProxyChtSession> {
    const username = headers[PROXY_USERNAME_HEADER];
    if (!username) {
      throw new Error(`proxy auth: missing ${PROXY_USERNAME_HEADER} header`);
    }

    const axiosInstance = buildChtAxiosInstance(authInfo, headers);
    const { facilityIds, chtCoreVersion } = await fetchChtUserMetadata(authInfo, username, { headers });

    return new ProxyChtSession(authInfo, username, facilityIds, chtCoreVersion, axiosInstance);
  }
}
