import { error, redirect } from '@sveltejs/kit';

import { api, type PlaceSummary } from '$lib/api';
import { allowsAction } from '$lib/config-types';
import { personFrom, sharedPersonOf, type SharedPerson, type StagedItem } from '$lib/staged';
import type { PageLoad } from './$types';

// /create: choose a type; /create?type=…: the form; /create?item=…: edit or fix a staged item;
// /create?person=…: another place for the person a staged item creates or shares
export const load: PageLoad = async ({ fetch, url, parent }) => {
  const { config } = await parent();
  const getItem = (id: string) => api<StagedItem>(fetch, `/staged-items/${encodeURIComponent(id)}`);
  const getPlace = (id: string | undefined) =>
    id ? api<PlaceSummary>(fetch, `/places/${encodeURIComponent(id)}`).catch(() => null) : Promise.resolve(null);
  const typeOf = (item: StagedItem) => {
    const contactType = config.contactTypes.find((type) => type.name === item.request.contactType);
    if (!contactType || item.kind !== 'create') {
      error(422, 'This item can’t be edited in this form.');
    }
    return contactType;
  };

  const itemId = url.searchParams.get('item');
  if (itemId) {
    const item = await getItem(itemId).catch((e) => error(e.status || 500, e.message));
    if (item.kind === 'replace') {
      redirect(307, `/replace?item=${encodeURIComponent(item.id)}`);
    }
    const contactType = typeOf(item);
    const personItem = item.dependsOn ? await getItem(item.dependsOn).catch(() => null) : null;
    return {
      mode: 'edit' as const,
      contactType,
      item,
      parentPlace: await getPlace(item.request.parentId),
      person: sharedPersonOf(item, personItem)
    };
  }

  const personId = url.searchParams.get('person');
  if (personId) {
    const from = await getItem(personId).catch((e) => error(e.status || 500, e.message));
    const contactType = typeOf(from);
    if (!contactType.can_assign_multiple) {
      error(422, `A ${contactType.friendly}'s person can't serve another place.`);
    }
    const personItem = from.dependsOn ? await getItem(from.dependsOn).catch(() => null) : null;
    const person: SharedPerson = personItem ? personFrom(personItem) : personFrom(from);
    // the next place is usually in the same area
    return { mode: 'create' as const, contactType, item: null, parentPlace: await getPlace(from.request.parentId), person };
  }

  const typeName = url.searchParams.get('type');
  const contactType = config.contactTypes.find((type) => type.name === typeName && allowsAction(type, 'create'));
  return { mode: contactType ? ('create' as const) : ('choose' as const), contactType, item: null, parentPlace: null, person: null };
};
