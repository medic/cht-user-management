import { externalOwnershipAttribute, hasMultipleRoles, type ContactProperty, type ContactType } from '../config';
import type { ValidationErrors } from '../../validation';
import { hierarchyWithReplacement } from './resolver';

// The previous version's flat bodies: hierarchy levels by property_name (after an optional prefix, eg.
// `source_`), `place_` + each place property, `contact_` + each contact property, `user_role` for a
// type with several roles, and the deployment's attribute_for_external_ownership. Other keys are
// ignored, as they were.

export const PLACE_PREFIX = 'place_';
export const CONTACT_PREFIX = 'contact_';
export const USER_ROLE_KEY = 'user_role';

export type LegacyForm = {
  // by property_name, `replacement` included
  hierarchy: Record<string, string>;
  place: Record<string, string>;
  contact: Record<string, string>;
  // the roles named, for a type with several; undefined when none were
  roles?: string[];
  // true or a reference claims the place for the external system, null releases it, undefined leaves it
  ownership?: true | string | null;
};

function text(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return Array.isArray(value) ? value.map(String).join(' ') : String(value);
}

function section(body: Record<string, unknown>, properties: ContactProperty[], prefix: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const property of properties) {
    // generated properties are worked out, whatever is sent
    const value = property.type === 'generated' ? undefined : text(body[prefix + property.property_name]);
    if (value !== undefined) {
      values[property.property_name] = value;
    }
  }
  return values;
}

export function readForm(body: Record<string, unknown>, contactType: ContactType, hierarchyPrefix = ''): LegacyForm {
  const hierarchy: Record<string, string> = {};
  for (const level of hierarchyWithReplacement(contactType)) {
    const value = text(body[hierarchyPrefix + level.property_name]);
    if (value !== undefined) {
      hierarchy[level.property_name] = value;
    }
  }

  const roles = hasMultipleRoles(contactType) ? text(body[USER_ROLE_KEY])?.split(' ').filter(Boolean) : undefined;
  return {
    hierarchy,
    place: section(body, contactType.place_properties, PLACE_PREFIX),
    contact: section(body, contactType.contact_properties, CONTACT_PREFIX),
    roles: roles?.length ? roles : undefined,
    ownership: ownershipClaim(body)
  };
}

export function ownershipClaim(body: Record<string, unknown>): true | string | null | undefined {
  const attribute = externalOwnershipAttribute();
  if (!attribute || !(attribute in body)) {
    return undefined;
  }
  const supplied = body[attribute];
  if (supplied === null || supplied === false) {
    return null;
  }
  if (supplied === true || (typeof supplied === 'string' && supplied.trim().length > 0)) {
    return supplied;
  }
  throw new Error(`"${attribute}" must be true, a reference to the external record, or null to release`);
}

// v2's field errors ("place.code", "user.roles") as the previous version keyed them ("place_code", "user_role")
export function legacyErrorKeys(errors: ValidationErrors): Record<string, string> {
  const renamed: Record<string, string> = {};
  for (const [key, message] of Object.entries(errors)) {
    const legacyKey = key === 'user.roles' ? USER_ROLE_KEY : key.replace(/^place\./, PLACE_PREFIX).replace(/^contact\./, CONTACT_PREFIX);
    renamed[legacyKey] = message;
  }
  return renamed;
}
