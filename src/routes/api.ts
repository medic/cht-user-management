import _ from 'lodash';

import { ChtApi } from '../lib/cht-api';
import { Config } from '../config';
import { FastifyInstance, FastifyRequest } from 'fastify';
import Fuse from 'fuse.js';
import Place, { PlaceUploadState } from '../services/place';
import PlaceFactory from '../services/place-factory';
import ManageHierarchyLib from '../lib/manage-hierarchy';
import SessionCache from '../services/session-cache';
import RemotePlaceCache from '../lib/remote-place-cache';
import RemotePlaceResolver from '../lib/remote-place-resolver';
import WarningSystem from '../warnings';
import { DisableUsers } from '../lib/disable-users';
import { SetUserFacilities } from '../services/set-user-facilities';
import { OidcUserPayload } from '../services/oidc-user-payload';

const DEFAULT_THRESHOLD = 0.6;

type SearchResult = {
  place_id: string;
  name: string;
  score: number;
};

type HierarchyResolutionError = {
  error: string;
  isAmbiguous: boolean;
  parentMissing: boolean;
};

export default async function api(fastify: FastifyInstance) {
  const createUserAndPlace = async (req: FastifyRequest) => {
    const formBody: any = req.body;
    ensureJsonObjectBody(formBody);

    const contactType = Config.getContactType(formBody.type);
    const chtApi = new ChtApi(req.chtSession);
    const sessionCache = req.sessionCache;

    // API requests are intended to be atomic and should not rely on the state of the session
    sessionCache.removeAll();

    const place = await PlaceFactory.createOne(formBody, contactType, sessionCache, chtApi, '');

    const hierarchyError = hierarchyResolutionError(place);
    if (hierarchyError) {
      return hierarchyError;
    }

    place.validate();
    if (place.hasValidationErrors) {
      return { success: false, errors: place.validationErrors };
    }

    await WarningSystem.setWarnings(contactType, chtApi, req.sessionCache);
    await fastify.uploadManager.doUpload([place], chtApi, true);

    if (place.state !== PlaceUploadState.SUCCESS) {
      return { success: false, errors: place.uploadError };
    }

    return {
      place_id: place.creationDetails.placeId,
      contact_id: place.creationDetails.contactId,
      username: place.creationDetails.username,
      password: place.creationDetails.password,
      warnings: place.warnings,
    };
  };
  
  fastify.post('/api/v1/create-user-and-place', createUserAndPlace);

  fastify.post('/api/v1/create-user', async (req) => {
    const formBody: any = req.body;
    ensureJsonObjectBody(formBody);

    const roles = normalizeRoles(formBody);
    const { oidc_username: oidcUsername, facility_ids: facilityIds, contact_id: contactId } = formBody;
    const validationError = validateCreateUser(oidcUsername, roles, facilityIds, contactId);
    if (validationError) {
      return { success: false, errors: validationError };
    }

    const chtApi = new ChtApi(req.chtSession);
    try {
      const resolvedContactId = await resolveContactId(contactId, facilityIds, chtApi);
      const payload = new OidcUserPayload(oidcUsername, roles, facilityIds, resolvedContactId);
      await chtApi.createUser(payload);
      return { success: true, username: payload.username };
    } catch (e: any) {
      return { error: e.response?.data?.error?.message ?? e.toString() };
    }
  });

  fastify.post('/api/v1/search', async (req) => {
    const formBody: any = req.body;
    ensureJsonObjectBody(formBody);

    const chtApi = new ChtApi(req.chtSession);
    
    if (shouldClearCache(req.query)) {
      RemotePlaceCache.clear(chtApi);
    }

    const resolution = await resolvePlacesFromHierarchy(formBody, getThreshold(req.query), chtApi, req.sessionCache);
    if ('error' in resolution) {
      return resolution;
    }

    return resolution.hits;
  });

  fastify.post('/api/v1/disable-users-at', async (req) => {
    const formBody: any = req.body;
    ensureJsonObjectBody(formBody);

    const chtApi = new ChtApi(req.chtSession);
    const resolution = await resolvePlacesFromHierarchy(formBody, getThreshold(req.query), chtApi, req.sessionCache);
    if ('error' in resolution) {
      return resolution;
    }

    const [facility] = resolution.hits;
    if (!facility) {
      return { success: false, error: 'no facility found matching the provided hierarchy' };
    }

    // Abort rather than guess
    const tiedForBestMatch = resolution.hits.filter(hit => hit.score === facility.score);
    if (tiedForBestMatch.length > 1) {
      const joinedNames = tiedForBestMatch.map(hit => hit.name).join(', ');
      return {
        success: false,
        isDuplicate: true,
        error: `ambiguous match: ${tiedForBestMatch.length} facilities tie for the best match (${joinedNames})`,
      };
    }

    try {
      const disabled = await DisableUsers.disableUsersAt([facility.place_id], chtApi);
      return {
        place_id: facility.place_id,
        place_name: facility.name,
        disabled,
      };
    } catch (e: any) {
      return { error: e.response?.data?.error?.message ?? e.toString() };
    }
  });

  fastify.post('/api/v1/set-user-facilities', async (req) => {
    const formBody: any = req.body;
    ensureJsonObjectBody(formBody);

    const { username, facility_ids: facilityIds } = formBody;
    const validationError = validateSetUserFacilities(username, facilityIds);
    if (validationError) {
      return { success: false, errors: validationError };
    }

    const chtApi = new ChtApi(req.chtSession);
    try {
      return await SetUserFacilities.setFacilities(username, facilityIds, chtApi);
    } catch (e: any) {
      return { error: e.response?.data?.error?.message ?? e.toString() };
    }
  });

  fastify.post('/api/v1/manage-hierarchy', async (req) => {
    const sessionCache: SessionCache = req.sessionCache;
    const chtApi = new ChtApi(req.chtSession);
    
    const formBody: any = req.body;
    ensureJsonObjectBody(formBody);
    const contactType = Config.getContactType(formBody.place_type);

    try {
      const job = await ManageHierarchyLib.getJobDetails(
        formBody,
        contactType,
        sessionCache,
        chtApi
      );

      await ManageHierarchyLib.scheduleJob(job);

      return {
        jobName: job.jobName,
        action: job.jobData.action,
        instanceUrl: job.jobData.instanceUrl,
        sourceId: job.jobData.sourceId,
        destinationId: job.jobData.destinationId,
      };
    } catch (e: any) {
      return { error: e.toString() };
    }
  });
}

function ensureJsonObjectBody(body: unknown) {
  if (!_.isPlainObject(body)) {
    throw new Error('body expected as application/json');
  }
}

// Accepts either `roles` (array) or `role` (string) from the payload and returns a clean list.
function normalizeRoles(body: any): string[] {
  const raw = body.roles ?? body.role;
  const list = Array.isArray(raw) ? raw : [raw];
  return list.filter(role => typeof role === 'string' && role.trim());
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length > 0
    && value.every(item => typeof item === 'string' && item.trim() !== '');
}

function validateCreateUser(
  oidcUsername: unknown,
  roles: string[],
  facilityIds: unknown,
  contactId: unknown,
): string | null {
  if (typeof oidcUsername !== 'string' || !oidcUsername.trim()) {
    return 'oidc_username is required';
  }

  if (!roles.length) {
    return 'role is required';
  }

  if (!isNonEmptyStringArray(facilityIds)) {
    return 'facility_ids must be a non-empty array of place ids';
  }

  // contact_id is optional: when omitted, it defaults to the first facility's primary contact
  if (contactId !== undefined && contactId !== null && (typeof contactId !== 'string' || !contactId.trim())) {
    return 'contact_id must be a non-empty string when provided';
  }

  return null;
}

// Resolves the contact id for the new user. When the caller does not supply one, default to the
// primary contact of the first facility
async function resolveContactId(
  contactId: unknown,
  facilityIds: string[],
  chtApi: ChtApi,
): Promise<string> {
  if (typeof contactId === 'string' && contactId.trim()) {
    return contactId;
  }

  const [facilityId] = facilityIds;
  let facility: any;
  try {
    facility = await chtApi.getDoc(facilityId);
  } catch (e: any) {
    if (e.response?.status === 404) {
      throw new Error(`CHU not found: no place with id "${facilityId}" exists in eCHIS`);
    }
    throw e;
  }
  const primaryContactId = facility?.contact?._id;
  if (typeof primaryContactId !== 'string' || !primaryContactId.trim()) {
    throw new Error(`contact_id is required: facility ${facilityId} has no primary contact`);
  }

  return primaryContactId;
}

function validateSetUserFacilities(username: unknown, facilityIds: unknown): string | null {
  if (typeof username !== 'string' || !username.trim()) {
    return 'username is required';
  }

  if (!isNonEmptyStringArray(facilityIds)) {
    return 'facility_ids must be a non-empty array of place ids';
  }

  return null;
}

function getThreshold(query: unknown): number {
  const threshold = (query as any)?.threshold;
  return threshold !== undefined ? parseFloat(threshold) : DEFAULT_THRESHOLD;
}

function shouldClearCache(query: any): boolean {
  const raw = query?.clear_cache;
  return raw === '1' || raw === 1 || raw === 'true' || raw === true;
}

// Resolves the parent hierarchy from form data and fuzzy-matches the base-level place by name,
// returning the candidate places ranked best-first. Shared by /search and /deactivate-users so
// both resolve a facility identically.
async function resolvePlacesFromHierarchy(
  formBody: any,
  threshold: number,
  chtApi: ChtApi,
  sessionCache: SessionCache,
): Promise<HierarchyResolutionError | { hits: SearchResult[] }> {
  const contactType = Config.getContactType(formBody.type);
  const [baseHierarchyLevel] = Config.getHierarchyWithReplacement(contactType);

  // API requests are intended to be atomic and should not rely on the state of the session
  sessionCache.removeAll();

  const data = _.pick(formBody, Config.getHierarchyWithReplacement(contactType).slice(1).map(l => l.property_name));
  const place = await PlaceFactory.createOne(data, contactType, sessionCache, chtApi, '');

  const hierarchyError = hierarchyResolutionError(place);
  if (hierarchyError) {
    return hierarchyError;
  }

  const parentId = place.resolvedHierarchy[1]?.id;
  const placesHavingParent = (await RemotePlaceCache.getRemotePlaces(chtApi, contactType, baseHierarchyLevel))
    .filter(remotePlace => remotePlace.lineage[0] === parentId);

  const fuse = new Fuse(placesHavingParent, {
    keys: ['name.formatted'],
    includeScore: true,
    threshold,
  });

  const hits: SearchResult[] = fuse
    .search(formBody[baseHierarchyLevel.property_name] ?? '')
    .map(({ item, score }) => ({
      name: item.name.original,
      place_id: item.id,
      score: score ?? 1,
    }))
    .sort((a, b) => a.score - b.score);

  return { hits };
}

function hierarchyResolutionError(place: Place): HierarchyResolutionError | null {
  const invalidIndex = place.resolvedHierarchy.findIndex(level => level?.type === 'invalid');
  if (invalidIndex === -1) {
    return null;
  }

  const invalid = place.resolvedHierarchy[invalidIndex];
  return {
    error: `hierarchy cannot be resolved: index ${invalidIndex} - ${invalid?.name.formatted}`,
    isAmbiguous: invalid?.id === RemotePlaceResolver.Multiple.id,
    parentMissing: invalid?.id === RemotePlaceResolver.NoResult.id,
  };
}
