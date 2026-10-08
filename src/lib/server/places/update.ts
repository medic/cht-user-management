import { externalOwnershipAttribute, type ContactProperty, type ContactType } from '../config';
import type { Cht, CouchDoc } from '../cht/client';
import { buildProperties, type PropertyInput, type ValidationErrors } from '../../validation';
import { contactRef, docType, TOOL } from './documents';
import { rememberPlace } from './lookup';

// Ported from the previous version's services/update-place-details.ts, served by
// /api/v1/update-place: corrects the properties of a place that already exists, and of its primary
// contact. Each value sent replaces the one on the doc; the rest are kept. What changed is recorded
// on each doc it was written to, in user_attribution.edits.

// the value a property held on the doc, which isn't always a string (eg. a numeric code)
export type PropertyValue = string | number | boolean | null;

// what happened to one property. `current` null removes it; `previous` null means it wasn't there
export type PropertyChange = { previous: PropertyValue; current: string | boolean | null };
export type PropertyChanges = Record<string, PropertyChange>;

export type UpdatePlaceRequest = {
  place: Record<string, string>;
  contact: Record<string, string>;
  // true or a reference claims the place for the external system, null releases it, undefined leaves it
  ownership?: true | string | null;
};

export type UpdatePlaceResult =
  | { success: true; placeId: string; contactId: string; place: PropertyChanges; contact: PropertyChanges }
  | { success: false; errors: ValidationErrors };

export async function updatePlaceDetails(
  cht: Cht,
  username: string,
  placeId: string,
  contactType: ContactType,
  request: UpdatePlaceRequest
): Promise<UpdatePlaceResult> {
  assertEditable(contactType);

  const placeDoc = await cht.getDoc(placeId);
  if (!placeDoc) {
    throw new Error(`place "${placeId}" was not found on this instance`);
  }
  const typeName = docType(placeDoc);
  if (typeName !== contactType.name) {
    throw new Error(`place "${placeId}" is of type "${typeName}", not "${contactType.name}"`);
  }
  const contactId = contactRef(placeDoc.contact);
  if (!contactId) {
    throw new Error(`place "${placeId}" has no primary contact to update`);
  }
  const contactDoc = await cht.getDoc(contactId);
  if (!contactDoc) {
    throw new Error(`contact "${contactId}" was not found on this instance`);
  }

  // the values on the docs, with the request's on top
  const built = buildProperties({
    contactType,
    mode: 'create',
    place: seed(placeDoc, contactType.place_properties, request.place),
    contact: seed(contactDoc, contactType.contact_properties, request.contact),
    lineage: {}
  });
  if (Object.keys(built.errors).length) {
    return { success: false, errors: built.errors };
  }

  const contactChanges = diff(contactDoc, built.contact, contactType.contact_properties);
  const placeChanges = { ...diff(placeDoc, built.place, contactType.place_properties), ...ownershipChange(placeDoc, request.ownership) };

  let contactWritten = false;
  try {
    if (Object.keys(contactChanges).length) {
      await writeWithAttribution(cht, contactDoc, contactChanges, username);
      contactWritten = true;
    }
    if (Object.keys(placeChanges).length) {
      await writeWithAttribution(cht, placeDoc, placeChanges, username);
      rememberPlace(cht, contactType.name, placeDoc);
    }
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    const partial = contactWritten ? ` (the contact "${contactId}" was already updated)` : '';
    throw new Error(`failed to update place "${placeId}": ${reason}${partial}`);
  }

  return { success: true, placeId, contactId, place: placeChanges, contact: contactChanges };
}

// A generated property is worked out again from values that may have changed, but one built from
// the places above can't be: they aren't resolved here. Regenerating chis-tg's
// "{{ contact.last_name }} {{ contact.first_name }} ({{ lineage.followup_area }})" would drop them
export function assertEditable(contactType: ContactType): void {
  const readsLineage = [...contactType.place_properties, ...contactType.contact_properties].find(
    (property) => property.type === 'generated' && /\blineage\b/.test(String(property.parameter))
  );
  if (readsLineage) {
    throw new Error(
      `cannot edit "${contactType.name}": the generated property "${readsLineage.property_name}" is built from ` +
        'the hierarchy, which is not resolved here'
    );
  }
}

// The property names the request may send, each prefixed as the previous version's bodies were
export function editableKeys(contactType: ContactType, placePrefix: string, contactPrefix: string): string[] {
  const ownership = externalOwnershipAttribute();
  return [
    ...contactType.place_properties.map((property) => placePrefix + property.property_name),
    ...contactType.contact_properties.map((property) => contactPrefix + property.property_name),
    ...(ownership ? [ownership] : [])
  ];
}

function seed(doc: CouchDoc, properties: ContactProperty[], edits: Record<string, string>): PropertyInput {
  const values: PropertyInput = {};
  for (const property of properties) {
    // generated values are worked out from the rest
    if (property.type !== 'generated') {
      values[property.property_name] = edits[property.property_name] ?? asString(doc[property.property_name]);
    }
  }
  return values;
}

// every property whose validated value differs from the doc's
function diff(doc: CouchDoc, values: Record<string, string>, properties: ContactProperty[]): PropertyChanges {
  const changes: PropertyChanges = {};
  for (const { property_name: name } of properties) {
    const validated = values[name] ?? '';
    if (validated !== asString(doc[name])) {
      changes[name] = { previous: asPropertyValue(doc[name]), current: validated };
    }
  }
  return changes;
}

// Unlike a create, an edit can also release the place: null removes the attribute. A place whose
// ownership wasn't mentioned is left as it is
function ownershipChange(placeDoc: CouchDoc, claim: true | string | null | undefined): PropertyChanges {
  const attribute = externalOwnershipAttribute();
  if (claim === undefined || !attribute) {
    return {};
  }
  const previous = placeDoc[attribute] ?? null;
  return claim === previous ? {} : { [attribute]: { previous, current: claim } };
}

async function writeWithAttribution(cht: Cht, doc: CouchDoc, changes: PropertyChanges, username: string): Promise<void> {
  for (const [name, { current }] of Object.entries(changes)) {
    if (current === null) {
      delete doc[name];
    } else {
      doc[name] = current;
    }
  }
  doc.user_attribution ||= {};
  doc.user_attribution.edits ||= [];
  doc.user_attribution.edits.push({ tool: TOOL, username, edited_time: Date.now(), changes });
  await cht.putDoc(doc);
}

// as on the doc, so the record says what was really there
function asPropertyValue(value: unknown): PropertyValue {
  if (value === undefined || value === null) {
    return null;
  }
  return typeof value === 'object' ? asString(value) : (value as PropertyValue);
}

// doc values aren't always strings (eg. a numeric code), but property values are
function asString(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  return typeof value === 'object' ? '' : String(value);
}
