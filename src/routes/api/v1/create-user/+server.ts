import { json } from '@sveltejs/kit';

import { operationContext } from '$lib/server/http';
import { ensureJsonObjectBody, isQueryFlagSet, legacyHandler, readLegacyBody } from '$lib/server/legacy/http';
import { createUser } from '$lib/server/legacy/users';

// POST /api/v1/create-user[?exclusiveFacilities=true] { oidc_username, role | roles, facility_ids, contact }
export const POST = legacyHandler(async ({ request, url, locals }) => {
  const body = await readLegacyBody(request);
  ensureJsonObjectBody(body);
  return json(await createUser(operationContext(locals), body, isQueryFlagSet(url, 'exclusiveFacilities')));
});
