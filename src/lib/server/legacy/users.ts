import type { OperationContext } from '../places/context';
import { assertEditable, editableKeys, updatePlaceDetails, type PropertyChanges } from '../places/update';
import { ChtError } from '../errors';
import {
  disableUsersAt,
  setUserFacilities,
  unassignFacilitiesFromOthers,
  UserNotFoundError,
  type UnassignedFacilityResult
} from '../users/facilities';
import { createOidcUser, sanitizeOidcUsername } from '../users/oidc';
import { CONTACT_PREFIX, legacyErrorKeys, ownershipClaim, PLACE_PREFIX, readForm } from './form';
import { errorMessage, errorString, legacyContactType } from './http';
import { searchPlaces } from './places';
import type { HierarchyResolutionError } from './resolver';

// The previous version's endpoints that change accounts and places the v2 API has no operation for:
// /api/v1/create-user, /set-user-facilities, /disable-users-at and /update-place. Each keeps its
// body, its checks and its answers.

// `roles` (a list) or `role` (one)
function normalizeRoles(body: Record<string, unknown>): string[] {
  const raw = body.roles ?? body.role;
  const list = Array.isArray(raw) ? raw : [raw];
  return list.filter((role): role is string => typeof role === 'string' && !!role.trim());
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string' && item.trim() !== '');
}

const nonEmptyString = (value: unknown): value is string => typeof value === 'string' && !!value.trim();

// what the previous version answered for a step that threw: CHT's message, or e.toString()
function failure(e: unknown): string {
  return e instanceof ChtError ? e.message : errorString(e);
}

export type CreateUserResult =
  { success: false; errors: string } | { success: true; username: string; unassigned?: UnassignedFacilityResult[] } | { error: string };

// POST /api/v1/create-user[?exclusiveFacilities=true] { oidc_username, role(s), facility_ids, contact }
export async function createUser(
  context: OperationContext,
  body: Record<string, unknown>,
  exclusiveFacilities: boolean
): Promise<CreateUserResult> {
  const roles = normalizeRoles(body);
  const { oidc_username: oidcUsername, facility_ids: facilityIds, contact } = body;
  const invalid = !nonEmptyString(oidcUsername)
    ? 'oidc_username is required'
    : !roles.length
      ? 'role is required'
      : !isNonEmptyStringArray(facilityIds)
        ? 'facility_ids must be a non-empty array of place ids'
        : !(typeof contact === 'object' && contact !== null && nonEmptyString((contact as Record<string, unknown>).name))
          ? 'contact is required and must include a name'
          : undefined;
  if (invalid) {
    return { success: false, errors: invalid };
  }

  try {
    const { username } = await createOidcUser(context.cht, {
      oidcUsername: oidcUsername as string,
      roles,
      facilityIds: facilityIds as string[],
      contact: contact as Record<string, unknown>
    });
    // opt-in: the places become this account's alone
    const unassigned = exclusiveFacilities ? await unassignFacilitiesFromOthers(context.cht, facilityIds as string[], username) : undefined;
    return { success: true, username, ...(unassigned ? { unassigned } : {}) };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

// POST /api/v1/set-user-facilities { username | oidc_username, facility_ids, role(s) }
export async function setFacilities(context: OperationContext, body: Record<string, unknown>) {
  const { username, oidc_username: oidcUsername, facility_ids: facilityIds } = body;
  const resolvedUsername = oidcUsername ? sanitizeOidcUsername(String(oidcUsername)) : username;
  const roles = normalizeRoles(body);
  const invalid = !nonEmptyString(resolvedUsername)
    ? 'username is required'
    : !isNonEmptyStringArray(facilityIds)
      ? 'facility_ids must be a non-empty array of place ids'
      : !roles.length
        ? 'role is required'
        : undefined;
  if (invalid) {
    return { success: false, errors: invalid };
  }

  try {
    return await setUserFacilities(context.cht, resolvedUsername as string, facilityIds as string[], roles);
  } catch (e) {
    // the remedy is to create the user, not to retry
    if (e instanceof UserNotFoundError) {
      return { success: false, error: e.message, userNotFound: true };
    }
    return { error: failure(e) };
  }
}

export type DisableUsersAtResult =
  | HierarchyResolutionError
  | { success: false; error: string; isDuplicate?: boolean }
  | { place_id: string; place_name: string; disabled: string[] }
  | { error: string };

// POST /api/v1/disable-users-at { type, <hierarchy levels>, replacement }: the accounts at the best
// match lose it, and those left with no place are disabled
export async function disableUsersAtPlace(context: OperationContext, body: Record<string, unknown>): Promise<DisableUsersAtResult> {
  const resolution = await searchPlaces(context, body);
  if ('error' in resolution) {
    return resolution;
  }

  const [facility] = resolution.hits;
  if (!facility) {
    return { success: false, error: 'no facility found matching the provided hierarchy' };
  }
  // abort rather than guess
  const tied = resolution.hits.filter((hit) => hit.score === facility.score);
  if (tied.length > 1) {
    return {
      success: false,
      isDuplicate: true,
      error: `ambiguous match: ${tied.length} facilities tie for the best match (${tied.map((hit) => hit.name).join(', ')})`
    };
  }

  try {
    const disabled = await disableUsersAt(context.cht, [facility.place_id]);
    return { place_id: facility.place_id, place_name: facility.name, disabled };
  } catch (e) {
    return { error: failure(e) };
  }
}

export type UpdatePlaceResult =
  | { success: false; errors: Record<string, string> | string }
  | { success: true; place_id: string; contact_id: string; place: PropertyChanges; contact: PropertyChanges }
  | { error: string };

// POST /api/v1/update-place?place_id=…&type=… { place_…, contact_…, <ownership attribute> }. The place
// and its type are on the query string, so the body is properties only
export async function updatePlace(context: OperationContext, url: URL, body: Record<string, unknown>): Promise<UpdatePlaceResult> {
  const placeId = url.searchParams.get('place_id');
  const type = url.searchParams.get('type');
  if (!placeId?.trim()) {
    return { success: false, errors: 'place_id query parameter is required' };
  }
  if (!type?.trim()) {
    return { success: false, errors: 'type query parameter is required' };
  }
  if ('place_id' in body) {
    return { success: false, errors: 'place_id belongs on the query string, not in the body' };
  }

  const contactType = legacyContactType(type);
  try {
    assertEditable(contactType);
    const known = editableKeys(contactType, PLACE_PREFIX, CONTACT_PREFIX);
    const unknown = Object.keys(body).filter((key) => !known.includes(key));
    if (unknown.length) {
      return { success: false, errors: Object.fromEntries(unknown.map((key) => [key, `is not a property of "${contactType.name}"`])) };
    }

    const form = readForm(body, contactType);
    const result = await updatePlaceDetails(context.cht, context.session.username, placeId, contactType, {
      place: form.place,
      contact: form.contact,
      ownership: ownershipClaim(body)
    });
    if (!result.success) {
      return { success: false, errors: legacyErrorKeys(result.errors) };
    }
    return { success: true, place_id: result.placeId, contact_id: result.contactId, place: result.place, contact: result.contact };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}
