import { randomUUID } from 'node:crypto';

import type { ContactType } from '../config';
import { ApiError, ChtError } from '../errors';
import type { OperationContext } from '../places/context';
import { createPlace } from '../places/create';
import { lineageIds } from '../places/documents';
import { allPlaces, clearPlaceCache, placesUnder } from '../places/lookup';
import { prepareReplace, replacePrimaryContact } from '../places/replace';
import { createRequest, replaceRequest } from '../places/schemas';
import { uniquePropertyMatches, type Warning } from '../places/unique';
import { buildProperties, resolveRoles, type ValidationErrors } from '../../validation';
import { legacyErrorKeys, readForm, type LegacyForm } from './form';
import { legacyContactType } from './http';
import { rankNameMatches } from './name-match';
import {
  asRemotePlace,
  hierarchyErrors,
  hierarchyResolutionError,
  hierarchyWithReplacement,
  resolveHierarchy,
  type HierarchyResolutionError
} from './resolver';

// The previous version's endpoints that name places by their hierarchy: POST /api/v1/search and
// /api/v1/create-user-and-place. Each runs on its own, as they did ("API requests are intended to
// be atomic and should not rely on the state of the session").

export type SearchHit = { place_id: string; name: string; score: number };

// The places of `body.type` under the parent its hierarchy names, best match for `body.replacement`
// first
export async function searchPlaces(
  context: OperationContext,
  body: Record<string, unknown>,
  options: { clearCache?: boolean } = {}
): Promise<HierarchyResolutionError | { hits: SearchHit[] }> {
  const contactType = legacyContactType(body.type);
  const [baseLevel] = hierarchyWithReplacement(contactType);
  if (options.clearCache) {
    clearPlaceCache();
  }

  // the levels above the place only: the place itself is what's searched for
  const { replacement: searchFor = '', ...parents } = readForm(body, contactType).hierarchy;
  const resolved = await resolveHierarchy(context.cht, context.session, contactType, parents);
  const hierarchyError = hierarchyResolutionError(resolved);
  if (hierarchyError) {
    return hierarchyError;
  }

  const parentId = resolved[1]?.id;
  const docs = parentId
    ? await placesUnder(context.cht, parentId, contactType.name)
    : ((await allPlaces(context.cht, contactType.name)) ?? []).filter((doc) => !lineageIds(doc).length);
  const places = docs.map((doc) => asRemotePlace(doc, baseLevel));
  const hits = rankNameMatches(searchFor, places, (place) => place.name.formatted).map(({ item, score }) => ({
    name: item.name.original,
    place_id: item.id,
    score
  }));
  return { hits };
}

export type CreateUserAndPlaceResult =
  | HierarchyResolutionError
  | { success: false; errors: Record<string, string> | string }
  | { place_id: string; contact_id: string; username: string; password: string | null | undefined; warnings: string[] };

// Creates the place, its person and their login under the parent its hierarchy names, or, when it
// names a place as `replacement`, has a new person take that place over (with every place of the
// outgoing person's login), as the replace in v2 does: the outgoing person is kept
export async function createUserAndPlace(context: OperationContext, body: Record<string, unknown>): Promise<CreateUserAndPlaceResult> {
  const contactType = legacyContactType(body.type);
  const form = readForm(body, contactType);
  const resolved = await resolveHierarchy(context.cht, context.session, contactType, form.hierarchy);
  const hierarchyError = hierarchyResolutionError(resolved);
  if (hierarchyError) {
    return hierarchyError;
  }

  const isReplacement = !!form.hierarchy.replacement;
  const levelErrors = hierarchyErrors(contactType, form.hierarchy, resolved);
  if (Object.keys(levelErrors).length) {
    return { success: false, errors: { ...propertyErrors(contactType, form, isReplacement), ...levelErrors } };
  }

  const contact = { id: randomUUID(), properties: form.contact };
  const user = form.roles ? { roles: form.roles } : undefined;
  // a release (null) has nothing to release on a new or replaced place
  const externalOwnership = form.ownership ?? undefined;
  try {
    if (!isReplacement) {
      const parentId = resolved[1]?.id;
      if (!parentId) {
        return { success: false, errors: 'the place has no parent' };
      }
      const request = createRequest.parse({
        contactType: contactType.name,
        parentId,
        place: form.place,
        contact,
        user,
        externalOwnership,
        // the previous version created the place whatever its warnings, and reported them
        ignoreWarnings: true
      });
      const { body: created } = await createPlace(context, randomUUID(), request);
      return {
        place_id: created.placeId,
        contact_id: created.contactId,
        username: created.username,
        password: created.password,
        warnings: created.warnings.map(legacyWarning)
      };
    }

    const placeId = resolved[0]!.id;
    const request = replaceRequest.parse({
      contactType: contactType.name,
      contact,
      scope: 'all',
      place: form.place,
      user,
      externalOwnership
    });
    // the previous version compared the place's values with every place's, its own included
    const prepared = await prepareReplace(context, placeId, request);
    const duplicates = await uniquePropertyMatches(context.cht, contactType, {
      placeId: '',
      parentId: prepared.placeDoc.parent?._id ?? '',
      values: prepared.built.place
    });
    const { body: replaced } = await replacePrimaryContact(context, placeId, request);
    return {
      place_id: replaced.placeId,
      contact_id: replaced.contactId,
      username: replaced.username,
      password: replaced.password,
      warnings: duplicates.map(legacyWarning)
    };
  } catch (e) {
    if (e instanceof ApiError && e.code === 'VALIDATION_FAILED') {
      return { success: false, errors: legacyErrorKeys((e.details ?? {}) as ValidationErrors) };
    }
    if (e instanceof ApiError || e instanceof ChtError) {
      return { success: false, errors: e.message };
    }
    throw e;
  }
}

// The property errors, for a request whose hierarchy is also wrong
function propertyErrors(contactType: ContactType, form: LegacyForm, isReplacement: boolean): Record<string, string> {
  const built = buildProperties({
    contactType,
    mode: isReplacement ? 'replace' : 'create',
    place: form.place,
    contact: form.contact,
    lineage: form.hierarchy
  });
  const errors: ValidationErrors = { ...built.errors };
  const roles = resolveRoles(contactType, form.roles);
  if (roles.error) {
    errors['user.roles'] = roles.error;
  }
  return legacyErrorKeys(errors);
}

// A duplicate warning as the previous version worded it
export function legacyWarning(warning: Warning): string {
  const duplicate = /^(A place with the same ".*"(?: and same parent)?) already exists$/.exec(warning.message);
  return duplicate && warning.placeIds
    ? `${duplicate[1]} exists on the instance. ID "${JSON.stringify(warning.placeIds)}"`
    : warning.message;
}
