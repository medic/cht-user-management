import { json } from '@sveltejs/kit';

import { jobDeps, requireAuth } from '$lib/server/http';
import { manageHierarchy } from '$lib/server/legacy/hierarchy';
import { ensureJsonObjectBody, legacyHandler, readLegacyBody } from '$lib/server/legacy/http';

// POST /api/v1/manage-hierarchy { op, place_type, source_<levels>, destination_<levels> }
export const POST = legacyHandler(async ({ request, locals }) => {
  const body = await readLegacyBody(request);
  ensureJsonObjectBody(body);
  return json(await manageHierarchy(jobDeps(locals), requireAuth(locals).instance, body));
});
