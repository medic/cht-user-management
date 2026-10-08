import { json } from '@sveltejs/kit';

import { operationContext } from '$lib/server/http';
import { ensureJsonObjectBody, legacyHandler, readLegacyBody } from '$lib/server/legacy/http';
import { setFacilities } from '$lib/server/legacy/users';

// POST /api/v1/set-user-facilities { username | oidc_username, facility_ids, role | roles }
export const POST = legacyHandler(async ({ request, locals }) => {
  const body = await readLegacyBody(request);
  ensureJsonObjectBody(body);
  return json(await setFacilities(operationContext(locals), body));
});
