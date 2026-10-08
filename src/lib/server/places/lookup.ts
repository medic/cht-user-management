import type { Cht, CouchDoc } from '../cht/client';
import { ApiError } from '../errors';
import { docType, lineageIds } from './documents';

// Finding places by type (APP.md → Finding places). A type with at most MAX_PLACES_LOADED places is
// read whole, once every few minutes, and searched in memory. A larger one, like households, is never
// read whole: only the places under one parent at a time.

const TTL_MS = 5 * 60 * 1000;
export const DEFAULT_MAX_PLACES_LOADED = 10_000;
let maxLoaded = DEFAULT_MAX_PLACES_LOADED;

// set from MAX_PLACES_LOADED at startup
export function setMaxPlacesLoaded(max: number): void {
  maxLoaded = max;
  sizes.clear();
}

type Cached<T> = Map<string, { at: number; value: Promise<T> }>;
const lists: Cached<CouchDoc[]> = new Map();
const sizes: Cached<boolean> = new Map();

// the value loaded in the last few minutes, or a fresh load; a failed load isn't kept
function cached<T>(cache: Cached<T>, key: string, load: () => Promise<T>): Promise<T> {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.at < TTL_MS) {
    return entry.value;
  }
  const value = load();
  cache.set(key, { at: Date.now(), value });
  value.catch(() => cache.delete(key));
  return value;
}

// More places of the type than the server reads whole. Counted as CHT lists them, up to one past the limit
export function isLarge(cht: Cht, type: string): Promise<boolean> {
  return cached(sizes, `${cht.domain}:${type}`, async () => (await cht.countPlacesOfType(type, maxLoaded + 1)) > maxLoaded);
}

// Every place of the type, or null for a large type
export async function allPlaces(cht: Cht, type: string): Promise<CouchDoc[] | null> {
  if (await isLarge(cht, type)) {
    return null;
  }
  return cached(lists, `${cht.domain}:${type}`, () => cht.placesOfType(type));
}

// Places of the type `depth` levels below the ancestor: 1 for its children, 2 for theirs, …
export async function placesUnder(cht: Cht, ancestorId: string, type: string, depth = 1): Promise<CouchDoc[]> {
  const all = await allPlaces(cht, type);
  if (all) {
    return all.filter((doc) => lineageIds(doc)[depth - 1] === ancestorId);
  }
  return (await cht.docsAtDepth(ancestorId, [depth])).filter((doc) => docType(doc) === type && lineageIds(doc)[depth - 1] === ancestorId);
}

// For a search or lookup that can't be narrowed to a parent
export function tooManyPlaces(what: string): ApiError {
  return new ApiError(422, 'PARENT_REQUIRED', `There are too many ${what} to look through them all. Choose the place above first.`);
}

// One run's lookups, such as a CSV file's rows: each parent's places are read once for the run
export type PlaceLookup = {
  all(type: string): Promise<CouchDoc[] | null>;
  under(ancestorId: string, type: string, depth?: number): Promise<CouchDoc[]>;
};

export function placeLookup(cht: Cht): PlaceLookup {
  const seen = new Map<string, Promise<CouchDoc[]>>();
  return {
    all: (type) => allPlaces(cht, type),
    under: (ancestorId, type, depth = 1) => {
      const key = `${ancestorId}:${type}:${depth}`;
      if (!seen.has(key)) seen.set(key, placesUnder(cht, ancestorId, type, depth));
      return seen.get(key)!;
    }
  };
}

// A place this server just wrote, added to its type's list rather than waiting for the next read
export function rememberPlace(cht: Cht, type: string, doc: CouchDoc): void {
  const entry = lists.get(`${cht.domain}:${type}`);
  if (entry) {
    entry.value = entry.value.then((docs) => [...docs.filter((d) => d._id !== doc._id), doc]);
  }
}

// Every instance's lists, or only those of the instance at `domain`
export function clearPlaceCache(domain?: string): void {
  for (const cache of [lists, sizes]) {
    if (domain === undefined) {
      cache.clear();
      continue;
    }
    for (const key of cache.keys()) {
      if (key.startsWith(`${domain}:`)) cache.delete(key);
    }
  }
}
