import { allowsAction } from '$lib/config-types';
import type { PageLoad } from './$types';

// /merge: choose a type; /merge?type=…: the form
export const load: PageLoad = async ({ url, parent }) => {
  const { config } = await parent();
  // only the types that can be merged
  const types = config.contactTypes.filter((type) => allowsAction(type, 'merge'));
  const contactType = types.find((type) => type.name === url.searchParams.get('type'));
  return { types, contactType };
};
