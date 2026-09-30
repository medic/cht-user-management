import { json } from '@sveltejs/kit';

import { apiHandler } from '$lib/server/http';
import { getSettings } from '$lib/server/settings';

// Public: the sign-in screen lists these. Hosts aren't exposed.
export const GET = apiHandler(async () => {
	return json({ instances: getSettings().instances.map(({ id, name }) => ({ id, name })) });
});
