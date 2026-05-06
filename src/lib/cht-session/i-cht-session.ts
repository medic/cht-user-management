import _ from 'lodash';
const axios = require('axios'); // require is needed for rewire
import { AxiosInstance, AxiosRequestConfig } from 'axios';
import axiosRetry from 'axios-retry';
import * as semver from 'semver';

import { AuthError } from '../authentication-error';
import { AuthenticationInfo } from '../../config';
import { axiosRetryConfig } from '../retry-logic';
import { RemotePlace } from '../remote-place-cache';
import { UserPermissionService } from '../../services/user-permissions';

export const ADMIN_FACILITY_ID = '*';
export const ADMIN_ROLES = ['admin', '_admin'];

export interface IChtSession {
  readonly authInfo: AuthenticationInfo;
  readonly username: string;
  readonly facilityIds: string[];
  readonly chtCoreVersion: string;
  readonly axiosInstance: AxiosInstance;
  readonly cacheKey: string;
  readonly isAdmin: boolean;
  isPlaceAuthorized(remotePlace: RemotePlace): boolean;
}

export function createChtUrl(authInfo: AuthenticationInfo, path: string): string {
  const protocol = authInfo.useHttp ? 'http' : 'https';
  return `${protocol}://${authInfo.domain}${path ? '/' : ''}${path}`;
}

export function buildChtAxiosInstance(
  authInfo: AuthenticationInfo,
  headers: Record<string, string>,
): AxiosInstance {
  const instance = axios.create({
    baseURL: createChtUrl(authInfo, ''),
    headers,
  });
  axiosRetry(instance, axiosRetryConfig);
  return instance;
}

export type ChtUserMetadata = {
  facilityIds: string[];
  chtCoreVersion: string;
  isAdmin: boolean;
};

export type FetchChtUserOptions = {
  allowAdmin?: boolean;
};

export async function fetchChtUserMetadata(
  authInfo: AuthenticationInfo,
  username: string,
  requestConfig: AxiosRequestConfig,
  opts: FetchChtUserOptions = {},
): Promise<ChtUserMetadata> {
  const paths = [`medic/org.couchdb.user:${username}`, 'api/v2/monitoring', 'api/v1/settings'];
  const fetches = paths.map(path => axios.get(createChtUrl(authInfo, path), requestConfig));
  const [
    { data: userDoc },
    { data: { version: { app: chtCoreVersion } } },
    { data: settings },
  ] = await Promise.all(fetches);

  const isAdmin = _.intersection(ADMIN_ROLES, userDoc?.roles).length > 0;
  if (isAdmin && opts.allowAdmin === false) {
    throw AuthError.LOGIN_DISALLOWED(username);
  }

  UserPermissionService.validateUserPermissions(userDoc, username, settings.permissions);

  const facilityIds = isAdmin
    ? [ADMIN_FACILITY_ID]
    : _.flatten([userDoc?.facility_id]).filter(Boolean);
  if (!facilityIds?.length) {
    throw AuthError.MISSING_FACILITY(username);
  }

  assertCoreVersion(chtCoreVersion, authInfo.domain);

  return { facilityIds, chtCoreVersion, isAdmin };
}

export function assertCoreVersion(chtCoreVersion: any, domain: string) {
  const coercedVersion = semver.valid(semver.coerce(chtCoreVersion));
  if (!coercedVersion) {
    throw AuthError.CANNOT_PARSE_CHT_VERSION(chtCoreVersion, domain);
  }

  if (semver.lt(coercedVersion, '4.7.0')) {
    throw AuthError.INCOMPATIBLE_CHT_CORE_VERSION(domain, chtCoreVersion);
  }
}

export function isPlaceAuthorizedFor(
  facilityIds: string[],
  remotePlace: RemotePlace,
): boolean {
  return facilityIds?.length > 0 && (
    facilityIds.includes(ADMIN_FACILITY_ID)
    || _.intersection(remotePlace?.lineage, facilityIds).length > 0
    || facilityIds.includes(remotePlace?.id)
  );
}
