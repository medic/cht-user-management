import { json } from '@sveltejs/kit';

import { operationContext } from '$lib/server/http';
import { ensureJsonObjectBody, legacyHandler, readLegacyBody } from '$lib/server/legacy/http';
import { updatePlace } from '$lib/server/legacy/users';

// POST /api/v1/update-place?place_id=…&type=… { place_…, contact_…, <ownership attribute> }
export const POST = legacyHandler(async ({ request, url, locals }) => {
  const body = await readLegacyBody(request);
  ensureJsonObjectBody(body);
  return json(await updatePlace(operationContext(locals), url, body));
});
