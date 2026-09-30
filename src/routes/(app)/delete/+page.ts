import { allowsAction } from '$lib/config-types';
import type { PageLoad } from './$types';

// /delete: choose a type; /delete?type=…: the form
export const load: PageLoad = async ({ url, parent }) => {
	const { config } = await parent();
	// only the types that can be deleted
	const types = config.contactTypes.filter((type) => allowsAction(type, 'delete'));
	const contactType = types.find((type) => type.name === url.searchParams.get('type'));
	return { types, contactType };
};
