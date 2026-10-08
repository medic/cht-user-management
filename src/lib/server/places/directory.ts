import type { Session } from '../auth/session';
import { friendlyTypeName } from '../config';
import type { Cht, CouchDoc } from '../cht/client';
import { ApiError } from '../errors';
import { contactRef, docType, lineageIds } from './documents';
import { allPlaces, placesUnder, tooManyPlaces } from './lookup';
import { normalize } from './unique';

export type PlaceSummary = {
  id: string;
  name: string;
  type: string;
  // parent first, then grandparent, …
  lineage: { id: string; name: string }[];
};

// Places the session may act on: the place, or one of its ancestors, is one of their facilities
export function isWithinFacilities(session: Session, doc: CouchDoc): boolean {
  return session.facilityIds.includes('*') || [doc._id, ...lineageIds(doc)].some((id) => session.facilityIds.includes(id));
}

// GET /api/v2/places/search: places of a type whose name matches, best matches first. Under a parent,
// only that parent's places are read; without one, a type too large to read whole can't be searched
export async function searchPlaces(
  cht: Cht,
  session: Session,
  query: { type: string; q?: string; parentId?: string; limit: number }
): Promise<PlaceSummary[]> {
  const wanted = normalize(query.q?.trim() ?? '');
  const docs = query.parentId ? await placesUnder(cht, query.parentId, query.type) : await allPlaces(cht, query.type);
  if (!docs) {
    throw tooManyPlaces(`${friendlyTypeName(query.type)} places`);
  }
  const candidates = docs
    .filter((doc) => isWithinFacilities(session, doc))
    .map((doc) => ({ doc, name: String(doc.name ?? ''), rank: matchRank(normalize(String(doc.name ?? '')), wanted) }))
    .filter((c) => c.rank !== undefined)
    .sort((a, b) => a.rank! - b.rank! || a.name.localeCompare(b.name))
    .slice(0, query.limit);

  return withLineage(
    cht,
    candidates.map((c) => c.doc)
  );
}

// exact, then starts with, then a word starts with, then contains anywhere; undefined for no match
function matchRank(name: string, wanted: string): number | undefined {
  if (!wanted) return 3;
  if (name === wanted) return 0;
  if (name.startsWith(wanted)) return 1;
  if (name.split(/[\s\-/()]+/).some((word) => word.startsWith(wanted))) return 2;
  if (name.includes(wanted)) return 3;
  return undefined;
}

export type PlaceDetail = PlaceSummary & {
  properties: Record<string, string>;
  // who is behind the place now, for the replace form to show before anything changes
  primaryContact: { id: string; name: string; phone?: string; properties: Record<string, string> } | null;
  accounts: { username: string; roles: string[]; active: boolean; places: { id: string; name: string }[] }[];
};

// GET /api/v2/places/{id}
export async function placeDetail(cht: Cht, session: Session, id: string): Promise<PlaceDetail> {
  const doc = await cht.getDoc(id);
  const isPlace = doc && docType(doc) && !['person', 'data_record'].includes(String(doc.type));
  if (!doc || !isPlace) {
    throw new ApiError(404, 'PLACE_NOT_FOUND', `place "${id}" was not found`);
  }
  if (!isWithinFacilities(session, doc)) {
    throw new ApiError(403, 'FORBIDDEN_PLACE', 'you are not allowed to manage places in this part of the hierarchy');
  }
  const [summary] = await withLineage(cht, [doc]);

  const contactId = contactRef(doc.contact);
  const [person, users] = contactId ? await Promise.all([cht.getDoc(contactId), cht.usersByContact(contactId)]) : [null, []];
  const placeNames = await namesOf(
    cht,
    users.flatMap((user) => user.placeIds)
  );
  return {
    ...summary,
    properties: plainValues(doc),
    primaryContact: person
      ? {
          id: person._id,
          name: String(person.name ?? ''),
          phone: person.phone ? String(person.phone) : undefined,
          properties: plainValues(person)
        }
      : null,
    accounts: users.map((user) => ({
      username: user.username,
      roles: user.roles,
      active: !user.inactive,
      places: user.placeIds.map((placeId) => ({ id: placeId, name: placeNames.get(placeId) ?? placeId }))
    }))
  };
}

function plainValues(doc: CouchDoc): Record<string, string> {
  return Object.fromEntries(
    Object.entries(doc)
      .filter(
        ([key, value]) => !key.startsWith('_') && typeof value !== 'object' && !['type', 'contact_type', 'reported_date'].includes(key)
      )
      .map(([key, value]) => [key, String(value)])
  );
}

export async function namesOf(cht: Cht, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  return new Map((unique.length ? await cht.getDocs(unique) : []).map((doc) => [doc._id, String(doc.name ?? doc._id)]));
}

// Names for every ancestor of the given places, fetched in one request
async function withLineage(cht: Cht, docs: CouchDoc[]): Promise<PlaceSummary[]> {
  const ancestorIds = [...new Set(docs.flatMap((doc) => lineageIds(doc)))];
  const ancestors = new Map((await cht.getDocs(ancestorIds)).map((doc) => [doc._id, String(doc.name ?? doc._id)]));
  return docs.map((doc) => ({
    id: doc._id,
    name: String(doc.name ?? doc._id),
    type: docType(doc) ?? '',
    lineage: lineageIds(doc).map((ancestorId) => ({ id: ancestorId, name: ancestors.get(ancestorId) ?? ancestorId }))
  }));
}
