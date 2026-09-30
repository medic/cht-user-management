import { error } from '@sveltejs/kit';

import { api, type PersonMatch, type PlaceDetail, type ReplacePreview } from '$lib/api';
import { allowsAction } from '$lib/config-types';
import type { StagedItem } from '$lib/staged';
import type { PageLoad } from './$types';

// /replace: choose a type; /replace?type=…: the form; /replace?item=…: edit a staged replace item
export const load: PageLoad = async ({ fetch, url, parent }) => {
	const { config } = await parent();
	const itemId = url.searchParams.get('item');

	if (itemId) {
		const item = await api<StagedItem>(fetch, `/staged-items/${encodeURIComponent(itemId)}`).catch((e) => error(e.status || 500, e.message));
		const contactType = config.contactTypes.find((type) => type.name === item.request.contactType);
		if (!contactType || item.kind !== 'replace') {
			error(422, 'This item can’t be edited in this form.');
		}
		const place = await api<PlaceDetail>(fetch, `/places/${encodeURIComponent(item.request.placeId)}`).catch(() => null);
		// an existing incoming person: who they are, as the form shows a pick
		let existingPerson: PersonMatch | null = null;
		if (!item.request.contact?.properties) {
			const preview = await api<ReplacePreview>(fetch, '/preview', { method: 'POST', body: { kind: 'replace', request: item.request } }).catch(() => null);
			const name = preview?.incoming.name || item.summary.person?.split('→').at(-1)?.trim() || item.request.contact.id;
			existingPerson = { id: item.request.contact.id, name, eligible: true, account: preview?.incoming.username ? { username: preview.incoming.username, active: true, roles: [], places: [] } : undefined };
		}
		return { mode: 'edit' as const, contactType, item, place, existingPerson };
	}

	const typeName = url.searchParams.get('type');
	const contactType = config.contactTypes.find((type) => type.name === typeName && allowsAction(type, 'replace'));
	return { mode: contactType ? ('replace' as const) : ('choose' as const), contactType, item: null, place: null, existingPerson: null };
};
