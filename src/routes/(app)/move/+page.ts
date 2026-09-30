import { allowsAction } from '$lib/config-types';
import type { PageLoad } from './$types';

// /move: choose a type; /move?type=…: the form
export const load: PageLoad = async ({ url, parent }) => {
  const { config } = await parent();
  // only the types that can be moved
  const types = config.contactTypes.filter((type) => allowsAction(type, 'move'));
  const contactType = types.find((type) => type.name === url.searchParams.get('type'));
  return { types, contactType };
};
