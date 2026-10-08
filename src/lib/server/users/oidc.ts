import type { Cht } from '../cht/client';
import { isChtStatus } from '../errors';
import { sanitizeUsername } from '../username';

// Ported from the previous version's /api/v1/create-user and services/oidc-user-payload.ts: an
// account for someone who signs in through the identity provider, over several existing places,
// with a new person as their primary contact.

// A CHT-safe username from an oidc_username, usually an email: "demo@email.com" → "demo_at_email_dot_com"
export function sanitizeOidcUsername(oidcUsername: string | undefined): string {
  return sanitizeUsername(oidcUsername?.replace(/@/g, '_at_')?.replace(/\./g, '_dot_'));
}

export type OidcUserRequest = {
  oidcUsername: string;
  roles: string[];
  facilityIds: string[];
  // the new person's fields, as CHT's people API takes them; at least a name
  contact: Record<string, unknown>;
};

// Always a new person, under the first place and primary contact of every place, then the account
export async function createOidcUser(cht: Cht, request: OidcUserRequest): Promise<{ username: string; contactId: string }> {
  const contactId = await createPrimaryContact(cht, request.contact, request.facilityIds);
  const username = sanitizeOidcUsername(request.oidcUsername);
  await cht.createOidcUser({
    username,
    oidc_username: request.oidcUsername,
    roles: request.roles,
    place: request.facilityIds,
    contact: contactId
  });
  return { username, contactId };
}

async function createPrimaryContact(cht: Cht, contact: Record<string, unknown>, facilityIds: string[]): Promise<string> {
  const [firstFacilityId] = facilityIds;
  const contactId = await facilityFound(firstFacilityId, () => cht.createPerson(firstFacilityId, contact));
  for (const facilityId of facilityIds) {
    await setPrimaryContact(cht, facilityId, contactId);
  }
  return contactId;
}

// As the previous version did: the place's contact becomes the person, and the one it had is recorded
async function setPrimaryContact(cht: Cht, facilityId: string, contactId: string): Promise<void> {
  const doc = await cht.getDoc(facilityId);
  if (!doc) {
    throw facilityNotFound(facilityId);
  }
  const previous = doc.contact?._id;
  doc.contact = { _id: contactId };
  doc.user_attribution ||= {};
  doc.user_attribution.previousPrimaryContacts ||= [];
  if (previous) {
    doc.user_attribution.previousPrimaryContacts.push(previous);
  }
  await cht.putDoc(doc);
}

// CHT's opaque 404 names the place it couldn't find
async function facilityFound<T>(facilityId: string, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (e) {
    if (isChtStatus(e, 404)) {
      throw facilityNotFound(facilityId);
    }
    throw e;
  }
}

function facilityNotFound(facilityId: string): Error {
  return new Error(`Facility place "${facilityId}" was not found in this eCHIS instance`);
}
