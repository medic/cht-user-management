import type { ContactProperty, ContactType } from '../config';
import type { Cht, CouchDoc } from '../cht/client';
import { formatValue } from '../../validation/validators';
import type { PropertyValues } from '../../validation';

// A read-through cache of all places of a type, so a batch doesn't refetch them for every item. It
// only feeds warnings; nothing is written based on it.
const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; docs: Promise<CouchDoc[]> }>();

export function placesOfType(cht: Cht, type: string): Promise<CouchDoc[]> {
	const key = `${cht.domain}:${type}`;
	const entry = cache.get(key);
	if (entry && Date.now() - entry.at < TTL_MS) {
		return entry.docs;
	}

	const docs = cht.placesOfType(type);
	cache.set(key, { at: Date.now(), docs });
	docs.catch(() => cache.delete(key));
	return docs;
}

export function rememberPlace(cht: Cht, type: string, doc: CouchDoc): void {
	const entry = cache.get(`${cht.domain}:${type}`);
	if (entry) {
		entry.docs = entry.docs.then((docs) => [...docs.filter((d) => d._id !== doc._id), doc]);
	}
}

export function clearPlaceCache(): void {
	cache.clear();
}

export function normalize(value: string): string {
	return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
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

	const docs = await placesOfType(cht, contactType.name);
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
