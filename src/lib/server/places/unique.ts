import type { ContactProperty, ContactType } from '../config';
import type { Cht } from '../cht/client';
import { formatValue } from '../../validation/validators';
import type { PropertyValues } from '../../validation';
import { allPlaces, placesUnder } from './lookup';

export function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

// A warning the user confirms before going ahead. placeIds: the existing places it's about, which
// clients link to.
export type Warning = { message: string; placeIds?: string[] };

export function duplicateWarning(property: ContactProperty, ids?: string[]): Warning {
  const parentClause = property.unique === 'parent' ? ' and same parent' : '';
  return ids
    ? { message: `A place with the same "${property.friendly_name}"${parentClause} already exists`, placeIds: ids }
    : { message: `Multiple entries have the same "${property.friendly_name}"${parentClause}` };
}

// As kept on the doc in CHT (user_attribution.warnings): plain text, with the ids
export function warningText(warning: Warning): string {
  return warning.placeIds?.length ? `${warning.message}: ${warning.placeIds.join(', ')}` : warning.message;
}

// Warnings read back from a doc in CHT, which are plain text
export function fromWarningTexts(texts: unknown): Warning[] {
  return Array.isArray(texts) ? texts.map((text) => ({ message: String(text) })) : [];
}

export type DuplicateMatch = Warning & { property: string; placeIds: string[] };

export async function uniquePropertyWarnings(
  cht: Cht,
  contactType: ContactType,
  target: { placeId: string; parentId: string; values: PropertyValues }
): Promise<Warning[]> {
  return (await uniquePropertyMatches(cht, contactType, target)).map(({ message, placeIds }) => ({ message, placeIds }));
}

// Ported from warnings/unique-property-classifier.ts for remote places: only place properties are
// compared, because contact values aren't fetched for remote places
export async function uniquePropertyMatches(
  cht: Cht,
  contactType: ContactType,
  target: { placeId: string; parentId: string; values: PropertyValues }
): Promise<DuplicateMatch[]> {
  const properties = contactType.place_properties.filter((p) => p.unique && target.values[p.property_name]);
  if (!properties.length) {
    return [];
  }

  // only the parent's places when every property is unique within its parent. A type too large to
  // read whole is checked within the parent too, even for "all" (APP.md → Finding places)
  const everywhere = properties.some((p) => p.unique === 'all') ? await allPlaces(cht, contactType.name) : null;
  const docs = everywhere ?? (await placesUnder(cht, target.parentId, contactType.name));
  const warnings: DuplicateMatch[] = [];
  for (const property of properties) {
    const wanted = normalize(target.values[property.property_name]);
    const duplicates = docs.filter((doc) => {
      const value = doc[property.property_name];
      if (doc._id === target.placeId || value === undefined || value === null) {
        return false;
      }
      if (property.unique === 'parent' && doc.parent?._id !== target.parentId) {
        return false;
      }
      const remote = String(value);
      // generated values, like a CHP area's name, are stored as rendered: nothing to format
      const formatted = property.type === 'generated' ? remote : formatValue(property, remote);
      return normalize(formatted) === wanted || normalize(remote) === wanted;
    });
    if (duplicates.length) {
      const placeIds = duplicates.map((doc) => doc._id);
      warnings.push({ property: `place.${property.property_name}`, message: duplicateWarning(property, placeIds).message, placeIds });
    }
  }
  return warnings;
}
