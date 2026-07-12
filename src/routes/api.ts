import _ from 'lodash';

import { ChtApi } from '../lib/cht-api';
import { Config } from '../config';
import { FastifyInstance, FastifyRequest } from 'fastify';
import { rankNameMatches } from '../lib/name-match';
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
import { sanitizeOidcUsername } from '../services/username';

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
    const { oidc_username: oidcUsername, facility_ids: facilityIds, contact } = formBody;
    const validationError = validateCreateUser(oidcUsername, roles, facilityIds, contact);
    if (validationError) {
      return { success: false, errors: validationError };
    }

    const chtApi = new ChtApi(req.chtSession);
    try {
      const contactId = await createPrimaryContactForFacilities(contact, facilityIds, chtApi);
      const payload = new OidcUserPayload(oidcUsername, roles, facilityIds, contactId);
      await chtApi.createUser(payload);

      // Opt-in via ?exclusiveFacilities=true: makes facilities exclusive
      const unassigned = isQueryFlagSet(req.query, 'exclusiveFacilities')
        ? await SetUserFacilities.unassignFacilitiesFromOthers(facilityIds, payload.username, chtApi)
        : undefined;

      return {
        success: true,
        username: payload.username,
        ...(unassigned ? { unassigned } : {}),
      };
    } catch (e: any) {
      return { error: e.response?.data?.error?.message ?? e.message ?? e.toString() };
    }
  });

  fastify.post('/api/v1/search', async (req) => {
    const formBody: any = req.body;
    ensureJsonObjectBody(formBody);

    const chtApi = new ChtApi(req.chtSession);
    
    if (isQueryFlagSet(req.query, 'clear_cache')) {
      RemotePlaceCache.clear(chtApi);
    }

    const resolution = await resolvePlacesFromHierarchy(formBody, chtApi, req.sessionCache);
    if ('error' in resolution) {
      return resolution;
    }

    return resolution.hits;
  });

  fastify.post('/api/v1/disable-users-at', async (req) => {
    const formBody: any = req.body;
    ensureJsonObjectBody(formBody);

    const chtApi = new ChtApi(req.chtSession);
    const resolution = await resolvePlacesFromHierarchy(formBody, chtApi, req.sessionCache);
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

    const { username, oidc_username: oidcUsername, facility_ids: facilityIds } = formBody;
    const resolvedUsername = oidcUsername ? sanitizeOidcUsername(oidcUsername) : username;
    const roles = normalizeRoles(formBody);
    const validationError = validateSetUserFacilities(resolvedUsername, facilityIds, roles);
    if (validationError) {
      return { success: false, errors: validationError };
    }

    const chtApi = new ChtApi(req.chtSession);
    try {
      return await SetUserFacilities.setFacilities(resolvedUsername, facilityIds, chtApi, roles);
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
  contact: any,
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

  const isValidContact = !!contact &&
    typeof contact === 'object' &&
    typeof contact.name === 'string' &&
    contact.name.trim();
  if (!isValidContact) {
    return 'contact is required and must include a name';
  }

  return null;
}

// A 404 from a place operation means the facility id does not exist in this CHT
// instance. Turn axios's opaque "Request failed with status code 404" into a clear,
// specific error naming the offending place.
async function assertFacilityFound<T>(facilityId: string, op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (e: any) {
    if (e?.response?.status === 404) {
      throw new Error(`Facility place "${facilityId}" was not found in this eCHIS instance`);
    }
    throw e;
  }
}

// Always creates a fresh person from the supplied contact details and makes it the primary contact of
// every facility passed
async function createPrimaryContactForFacilities(
  contact: Record<string, unknown>,
  facilityIds: string[],
  chtApi: ChtApi,
): Promise<string> {
  const [firstFacilityId] = facilityIds;
  const contactId = await assertFacilityFound(firstFacilityId, () => chtApi.createPersonUnderPlace(firstFacilityId, contact));

  for (const facilityId of facilityIds) {
    await assertFacilityFound(facilityId, () => chtApi.updatePlace(facilityId, contactId));
  }

  return contactId;
}

function validateSetUserFacilities(username: unknown, facilityIds: unknown, roles: string[]): string | null {
  if (typeof username !== 'string' || !username.trim()) {
    return 'username is required';
  }

  if (!isNonEmptyStringArray(facilityIds)) {
    return 'facility_ids must be a non-empty array of place ids';
  }

  if (!roles.length) {
    return 'role is required';
  }

  return null;
}

function isQueryFlagSet(query: any, name: string): boolean {
  const raw = query?.[name];
  return raw === '1' || raw === 1 || raw === 'true' || raw === true;
}

// Resolves the parent hierarchy from form data and matches the base-level place by name,
// returning the matching places ranked best-first.
async function resolvePlacesFromHierarchy(
  formBody: any,
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

  const searchString: string = formBody[baseHierarchyLevel.property_name] ?? '';
  const hits: SearchResult[] = rankNameMatches(searchString, placesHavingParent, remotePlace => remotePlace.name.formatted)
    .map(({ item, score }) => ({
      name: item.name.original,
      place_id: item.id,
      score,
    }));

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
