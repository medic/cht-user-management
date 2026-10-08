import { json } from '@sveltejs/kit';

import { operationContext } from '$lib/server/http';
import { ensureJsonObjectBody, legacyHandler, readLegacyBody } from '$lib/server/legacy/http';
import { createUserAndPlace } from '$lib/server/legacy/places';

// POST /api/v1/create-user-and-place { type, <hierarchy levels>, place_…, contact_…, user_role? }
export const POST = legacyHandler(async ({ request, locals }) => {
  const body = await readLegacyBody(request);
  ensureJsonObjectBody(body);
  return json(await createUserAndPlace(operationContext(locals), body));
});
