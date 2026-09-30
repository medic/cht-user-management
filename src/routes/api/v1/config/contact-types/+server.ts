import { json } from '@sveltejs/kit';

import { configVersion, deployment } from '$lib/server/config';
import { apiHandler } from '$lib/server/http';

// hooks are the server's business: the browser gets every other setting
export const GET = apiHandler(async () =>
	json({ configVersion: configVersion(), contactTypes: deployment().config.contact_types.map(({ hooks: _, ...type }) => type) })
);
