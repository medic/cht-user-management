import { json } from '@sveltejs/kit';

import { configVersion, deployment } from '$lib/server/config';
import { apiHandler, requireAuth } from '$lib/server/http';

// hooks are the server's business: the browser gets every other setting
export const GET = apiHandler(async ({ locals }) => {
  requireAuth(locals);
  return json({ configVersion: configVersion(), contactTypes: deployment().config.contact_types.map(({ hooks: _, ...type }) => type) });
});
