import type { Session } from '../auth/session';
import type { Cht, CouchDoc } from '../cht/client';
import { deployment, type ContactType, type HierarchyConstraint } from '../config';
import { formatValue } from '../../validation/validators';
import { isWithinFacilities } from '../places/directory';
import { lineageIds } from '../places/documents';
import { allPlaces, placesUnder } from '../places/lookup';

// The previous version's place resolution (lib/remote-place-resolver.ts, always used with `fuzz`), for
// the /api/v1 endpoints that name places by their hierarchy. A name matches a place when it equals
// the place's name, or its formatted form does, ignoring case. Two places with the same name are
// told apart by the levels below them, eg. a CHU's name picks which of two same-named sub counties
// it's under. Places outside the caller's facilities aren't found.

export type LegacyName = { original: string; formatted: string };

export type RemotePlace = {
  id: string;
  name: LegacyName;
  placeType: string;
  // parent first
  lineage: string[];
  type: 'remote' | 'invalid';
  ambiguities?: RemotePlace[];
};

// What a level resolves to when no place matches, or several do
export const NO_RESULT: RemotePlace = {
  id: 'na',
  name: { original: 'Place Not Found', formatted: 'Place Not Found' },
  placeType: 'invalid',
  type: 'invalid',
  lineage: []
};
export const MULTIPLE: RemotePlace = {
  id: 'multiple',
  name: { original: 'multiple places', formatted: 'multiple places' },
  placeType: 'invalid',
  type: 'invalid',
  lineage: []
};

// The place's own level is `replacement`, at level 0, then its hierarchy
export function hierarchyWithReplacement(contactType: ContactType, order: 'asc' | 'desc' = 'asc'): HierarchyConstraint[] {
  const replacement: HierarchyConstraint = {
    ...contactType.replacement_property,
    property_name: 'replacement',
    contact_type: contactType.name,
    level: 0
  };
  const levels = [...contactType.hierarchy, replacement].sort((a, b) => a.level - b.level);
  return order === 'asc' ? levels : levels.reverse();
}

export function legacyFormat(level: HierarchyConstraint, value: string): string {
  return level.type === 'generated' ? value : formatValue(level, value);
}

// Indexed by level: [0] the place itself (when named), [1] its parent, …
export type Resolved = (RemotePlace | undefined)[];

export async function resolveHierarchy(
  cht: Cht,
  session: Session,
  contactType: ContactType,
  names: Record<string, string>
): Promise<Resolved> {
  const topDown = hierarchyWithReplacement(contactType, 'desc');
  const resolved: Resolved = [];
  for (const level of topDown) {
    const original = names[level.property_name];
    if (!original) {
      continue;
    }

    const byName = new Map<string, RemotePlace>();
    for (const remotePlace of await searchPool(cht, session, topDown, level, resolved)) {
      addKeyToMap(byName, remotePlace.name.original, remotePlace);
      if (remotePlace.name.original !== remotePlace.name.formatted) {
        addKeyToMap(byName, remotePlace.name.formatted, remotePlace);
      }
    }
    resolved[level.level] = pickOptimistic(byName, { original, formatted: legacyFormat(level, original) });
  }

  resolveAmbiguousParents(topDown, resolved);
  return resolved;
}

// The places of the level's type the caller manages, under whatever was found above it
async function searchPool(
  cht: Cht,
  session: Session,
  topDown: HierarchyConstraint[],
  level: HierarchyConstraint,
  resolved: Resolved
): Promise<RemotePlace[]> {
  const docs = (await allPlaces(cht, level.contact_type)) ?? (await underNearestFound(cht, topDown, level, resolved));
  let pool = docs.filter((doc) => isWithinFacilities(session, doc)).map((doc) => asRemotePlace(doc, level));

  for (const above of topDown) {
    if (above.level <= level.level) {
      break;
    }
    const found = resolved[above.level];
    if (!found) {
      continue;
    }
    const ids = [found.id, ...(found.ambiguities?.map((ambiguity) => ambiguity.id) ?? [])];
    pool = pool.filter((candidate) => {
      const nthParent = candidate.lineage[above.level - level.level - 1];
      return !nthParent || ids.includes(nthParent);
    });
  }
  return pool;
}

// A type too large to read whole (MAX_PLACES_LOADED) is read under the nearest place found above it,
// which is where the filter above would keep them from anyway
async function underNearestFound(cht: Cht, topDown: HierarchyConstraint[], level: HierarchyConstraint, resolved: Resolved) {
  const nearest = [...topDown].reverse().find((above) => above.level > level.level && resolved[above.level]);
  if (!nearest) {
    throw new Error(`There are too many places of type "${level.contact_type}" to look through them all: name the place above`);
  }
  const found = resolved[nearest.level]!;
  const ids = found.type === 'invalid' ? (found.ambiguities ?? []).map((ambiguity) => ambiguity.id) : [found.id];
  const lists = await Promise.all(ids.map((id) => placesUnder(cht, id, level.contact_type, nearest.level - level.level)));
  return lists.flat();
}

export function asRemotePlace(doc: CouchDoc, level: HierarchyConstraint): RemotePlace {
  const original = doc.name === undefined || doc.name === null ? '' : String(doc.name);
  return {
    id: doc._id,
    name: { original, formatted: legacyFormat(level, original) },
    placeType: level.contact_type,
    lineage: lineageIds(doc),
    type: 'remote'
  };
}

function addKeyToMap(map: Map<string, RemotePlace>, key: string, value: RemotePlace) {
  const lowercaseKey = key.toLowerCase();
  const existing = map.get(lowercaseKey);
  if (existing && existing.id !== value.id) {
    if (existing.id !== MULTIPLE.id) {
      map.set(lowercaseKey, { ...MULTIPLE, ambiguities: [existing] });
    }
    const { ambiguities } = map.get(lowercaseKey)!;
    if (!ambiguities?.some((ambiguity) => ambiguity.id === value.id)) {
      ambiguities?.push(value);
    }
    return;
  }
  map.set(lowercaseKey, value);
}

function pickOptimistic(map: Map<string, RemotePlace>, name: LegacyName): RemotePlace {
  const result = map.get(name.original.toLowerCase());
  const fuzzyResult = map.get(name.formatted.toLowerCase());
  const [optimistic] = [result, fuzzyResult].filter((r) => r && r.type !== 'invalid');
  return optimistic ?? result ?? fuzzyResult ?? NO_RESULT;
}

// A level that matched several places takes the one a level below it is under
function resolveAmbiguousParents(topDown: HierarchyConstraint[], resolved: Resolved) {
  const ambiguous = resolved
    .map((remotePlace, index) => ({ index, remotePlace }))
    .filter(({ remotePlace }) => !!remotePlace?.ambiguities?.length)
    .reverse();

  for (const { index, remotePlace } of ambiguous) {
    for (const below of topDown) {
      if (below.level >= index) {
        continue;
      }
      const disambiguating = resolved[below.level];
      if (!disambiguating || disambiguating.type === 'invalid') {
        continue;
      }
      const disambiguated = remotePlace!.ambiguities!.filter(
        (ambiguity) => ambiguity.id === disambiguating.lineage[index - below.level - 1]
      );
      if (disambiguated.length === 1) {
        resolved[index] = disambiguated[0];
      }
    }
  }
}

export type HierarchyResolutionError = { error: string; isAmbiguous: boolean; parentMissing: boolean };

// The first level that matched no place, or several
export function hierarchyResolutionError(resolved: Resolved): HierarchyResolutionError | null {
  const invalidIndex = resolved.findIndex((level) => level?.type === 'invalid');
  if (invalidIndex === -1) {
    return null;
  }
  const invalid = resolved[invalidIndex];
  return {
    error: `hierarchy cannot be resolved: index ${invalidIndex} - ${invalid?.name.formatted}`,
    isAmbiguous: invalid?.id === MULTIPLE.id,
    parentMissing: invalid?.id === NO_RESULT.id
  };
}

// The previous version's errors for hierarchy levels, keyed by `prefix` + property_name: a required
// level that wasn't found, or a level that matched nothing or several places
export function hierarchyErrors(
  contactType: ContactType,
  names: Record<string, string>,
  resolved: Resolved,
  prefix = ''
): Record<string, string> {
  const errors: Record<string, string> = {};
  const levels = hierarchyWithReplacement(contactType);
  levels.forEach((level, index) => {
    const original = names[level.property_name] ?? '';
    if (level.level === 0 && !legacyFormat(level, original)) {
      return;
    }
    const resolution = resolved[level.level];
    const isValid = resolution?.type !== 'invalid' && (!level.required || resolution?.type === 'remote');
    if (!isValid) {
      const levelUp = levels[index + 1]?.property_name;
      errors[prefix + level.property_name] = describeInvalid(resolution, level.contact_type, original, levelUp && names[levelUp]);
    }
  });
  return errors;
}

function describeInvalid(remotePlace: RemotePlace | undefined, type: string, searchStr: string, requiredParent?: string): string {
  const friendlyName = deployment().config.contact_types.find((contactType) => contactType.name === type)?.friendly ?? type;
  if (!searchStr) {
    return `Cannot find ${friendlyName} because the search string is empty`;
  }
  const requiredParentSuffix = requiredParent ? ` under '${requiredParent}'` : '';
  if (remotePlace?.id === MULTIPLE.id) {
    const ambiguityDetails = JSON.stringify(remotePlace.ambiguities?.map((ambiguity) => ambiguity.id));
    return `Found multiple ${friendlyName}s matching '${searchStr}'${requiredParentSuffix} ${ambiguityDetails}`;
  }
  return `Cannot find '${friendlyName}' matching '${searchStr}'${requiredParentSuffix}`;
}
