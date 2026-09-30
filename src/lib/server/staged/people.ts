import type { ContactType } from '../../config-types';
import type { PropertyInput } from '../../validation';
import { formatValue } from '../../validation/validators';
import { normalize } from '../places/unique';
import type { StagedItem } from './types';

// One person, many places (APP.md → One person, many places): finding the people in a staged list
// that a new row or form entry may be

// Every person field as it would be stored (so "0712 345 678" and "+254712345678" match), ignoring
// case, accents and spacing, plus the roles. Undefined when there's nothing to compare. Only call it
// with person fields that passed validation.
export function personKey(
  contactType: ContactType,
  properties: PropertyInput | undefined,
  roles: string[] | undefined
): string | undefined {
  const values = contactType.contact_properties
    .filter((p) => p.type !== 'generated')
    .map((p) => {
      const value = properties?.[p.property_name];
      const text = Array.isArray(value) ? [...value].sort().join(',') : (value ?? '');
      return normalize(formatValue(p, text)).replace(/\s+/g, ' ').trim();
    });
  if (values.every((value) => !value)) {
    return undefined;
  }
  return JSON.stringify([...values, [...(roles ?? [])].sort().join(',')]);
}

// The key of the person an item creates: only items sending the person's details, of a type that
// can share, and whose person fields are valid. A person with errors is never matched, so it can
// be fixed on its own.
export function itemPersonKey(contactType: ContactType, item: StagedItem): string | undefined {
  if (item.kind !== 'create' || item.request.contactType !== contactType.name || !contactType.can_assign_multiple) {
    return undefined;
  }
  const properties = item.request.contact?.properties;
  if (!properties || Object.keys(item.errors ?? {}).some((path) => path.startsWith('contact.') || path === 'user.roles')) {
    return undefined;
  }
  return personKey(contactType, properties, item.request.user?.roles);
}

// The items that create a person, by person key; the earliest item wins
export function stagedPeople(contactType: ContactType, items: StagedItem[]): Map<string, StagedItem> {
  const people = new Map<string, StagedItem>();
  for (const item of [...items].sort((a, b) => a.sequence - b.sequence)) {
    const key = itemPersonKey(contactType, item);
    if (key && !people.has(key)) {
      people.set(key, item);
    }
  }
  return people;
}

// What the form shows about a staged person it might be the same as
export function describeMatch(item: StagedItem) {
  return {
    itemId: item.id,
    contactId: item.request.contact.id as string,
    name: item.summary.person,
    placeTitle: item.summary.title,
    properties: item.request.contact.properties as PropertyInput,
    roles: item.request.user?.roles as string[] | undefined
  };
}
