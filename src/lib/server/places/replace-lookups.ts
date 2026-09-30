import type { Session } from '../auth/session';
import type { Cht } from '../cht/client';
import { getContactType } from '../config';
import type { OperationContext } from './context';
import { contactRef } from './documents';
import { isWithinFacilities, namesOf } from './directory';
import { eligibility, prepareReplace, type PersonNotEligible } from './replace';
import type { ReplaceRequest } from './schemas';
import { allPlaces, tooManyPlaces } from './lookup';
import { normalize } from './unique';

// Read-only lookups for the replace form (APP.md → Replacing in the UI)

export type PersonMatch = {
  id: string;
  name: string;
  phone?: string;
  account?: { username: string; active: boolean; roles: string[]; places: { id: string; name: string }[] };
  eligible: boolean;
  reason?: PersonNotEligible;
};

// GET /api/v1/people/search: people who could take over a place of this type. They're found among
// the primary contacts of the type's places, within the caller's facilities, since that's who holds
// an account with the type's roles. Everyone found is listed; `eligible` says who can be picked.
export async function searchPeople(cht: Cht, session: Session, query: { type: string; q?: string; limit: number }): Promise<PersonMatch[]> {
  const contactType = getContactType(query.type, 'replace');
  const wanted = normalize(query.q?.trim() ?? '');
  // the type's places are searched whole: a type too large for that is replaced by picking the place
  const all = await allPlaces(cht, contactType.name);
  if (!all) {
    throw tooManyPlaces(`${contactType.friendly} places to search their people`);
  }
  const places = all.filter((doc) => isWithinFacilities(session, doc));
  const contactIds = [...new Set(places.map((doc) => contactRef(doc.contact)).filter((id): id is string => !!id))];
  const people = (contactIds.length ? await cht.getDocs(contactIds) : [])
    .filter((doc) => doc.type === contactType.contact_type || doc.contact_type === contactType.contact_type)
    .filter((doc) => isWithinFacilities(session, doc))
    .map((doc) => ({ doc, name: String(doc.name ?? ''), rank: rankOf(normalize(String(doc.name ?? '')), wanted) }))
    .filter((match) => match.rank !== undefined)
    .sort((a, b) => a.rank! - b.rank! || a.name.localeCompare(b.name))
    .slice(0, query.limit);

  const accounts = await Promise.all(people.map(({ doc }) => cht.usersByContact(doc._id)));
  const placeNames = await namesOf(
    cht,
    accounts.flat().flatMap((account) => account.placeIds)
  );
  return people.map(({ doc, name }, index) => {
    const { account, reason } = eligibility(contactType, accounts[index]);
    const shown = account ?? accounts[index][0];
    return {
      id: doc._id,
      name,
      phone: doc.phone ? String(doc.phone) : undefined,
      account: shown && {
        username: shown.username,
        active: !shown.inactive,
        roles: shown.roles,
        places: shown.placeIds.map((id) => ({ id, name: placeNames.get(id) ?? id }))
      },
      eligible: !reason,
      ...(reason ? { reason } : {})
    };
  });
}

function rankOf(name: string, wanted: string): number | undefined {
  if (!wanted) return 3;
  if (name === wanted) return 0;
  if (name.startsWith(wanted)) return 1;
  if (name.split(/[\s\-/()]+/).some((word) => word.startsWith(wanted))) return 2;
  if (name.includes(wanted)) return 3;
  return undefined;
}

export type ReplacePreview = {
  state: 'fresh' | 'switched' | 'nothing_to_do';
  outgoing: { contactId: string; name: string } | null;
  incoming: { kind: 'new' | 'existing'; name: string; username?: string };
  placesHandedOver: { id: string; name: string }[];
  // the outgoing person's other places, which they keep
  placesKept: { id: string; name: string }[];
  retiredAccounts: { username: string; action: 'disable' | 'deactivate' }[];
  // accounts that only lose the places
  keptAccounts: { username: string }[];
  // the outgoing person is always kept, under their place; null when the place had no primary contact
  outgoingPerson: 'keep' | null;
  // generated place values that change, old → new
  generated: Record<string, { from: string; to: string }>;
};

// POST /api/v1/preview with kind "replace": what the replace would do, without doing it. It runs the
// replace's own checks, so a request the replace would refuse is refused here the same way.
export async function previewReplace(context: OperationContext, placeId: string, request: ReplaceRequest): Promise<ReplacePreview> {
  const prepared = await prepareReplace(context, placeId, request);
  const { contactType, placeDoc, outgoing, incoming, built } = prepared;
  const handedOverIds = [placeId, ...prepared.affectedPlaceIds];
  const keptIds = outgoing.otherPlaceIds.filter((id) => !handedOverIds.includes(id));
  const names = await namesOf(context.cht, [...handedOverIds, ...keptIds]);
  const named = (id: string) => ({ id, name: names.get(id) ?? id });

  const retired = outgoing.accounts.filter((account) => account.placeIds.every((id) => handedOverIds.includes(id)));
  const kept = outgoing.accounts.filter((account) => !retired.includes(account));
  const generated: ReplacePreview['generated'] = {};
  for (const property of contactType.place_properties.filter((p) => p.type === 'generated')) {
    const from = String(placeDoc[property.property_name] ?? '');
    const to = built.place[property.property_name] ?? '';
    if (to && to !== from) generated[`place.${property.property_name}`] = { from, to };
  }

  return {
    state: prepared.state,
    outgoing: outgoing.contactId ? { contactId: outgoing.contactId, name: String(outgoing.doc?.name ?? outgoing.contactId) } : null,
    incoming:
      incoming.kind === 'existing'
        ? { kind: 'existing', name: String(incoming.doc.name ?? ''), username: incoming.account.username }
        : { kind: 'new', name: String(built.contact.name ?? '') },
    placesHandedOver: handedOverIds.map(named),
    placesKept: keptIds.map(named),
    retiredAccounts: retired.map((account) => ({
      username: account.username,
      action: contactType.deactivate_users_on_replace ? 'deactivate' : 'disable'
    })),
    keptAccounts: kept.map((account) => ({ username: account.username })),
    outgoingPerson: outgoing.contactId ? 'keep' : null,
    generated
  };
}
