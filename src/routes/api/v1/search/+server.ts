import { json } from '@sveltejs/kit';

import { operationContext } from '$lib/server/http';
import { ensureJsonObjectBody, isQueryFlagSet, legacyHandler, readLegacyBody } from '$lib/server/legacy/http';
import { searchPlaces } from '$lib/server/legacy/places';

// POST /api/v1/search[?clear_cache=1] { type, <hierarchy levels>, replacement }: places of the type
// under the parent the levels name, best match for `replacement` first: [{ place_id, name, score }]
export const POST = legacyHandler(async ({ request, url, locals }) => {
  const body = await readLegacyBody(request);
  ensureJsonObjectBody(body);
  const result = await searchPlaces(operationContext(locals), body, { clearCache: isQueryFlagSet(url, 'clear_cache') });
  return json('hits' in result ? result.hits : result);
});
