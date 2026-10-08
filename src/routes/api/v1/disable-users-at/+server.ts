import { json } from '@sveltejs/kit';

import { operationContext } from '$lib/server/http';
import { ensureJsonObjectBody, legacyHandler, readLegacyBody } from '$lib/server/legacy/http';
import { disableUsersAtPlace } from '$lib/server/legacy/users';

// POST /api/v1/disable-users-at { type, <hierarchy levels>, replacement }
export const POST = legacyHandler(async ({ request, locals }) => {
  const body = await readLegacyBody(request);
  ensureJsonObjectBody(body);
  return json(await disableUsersAtPlace(operationContext(locals), body));
});
