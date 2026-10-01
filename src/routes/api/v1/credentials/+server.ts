import { json } from '@sveltejs/kit';

import { apiHandler, operationContext } from '$lib/server/http';
import { credentialsFor } from '$lib/server/places/credentials';
import { getSettings } from '$lib/server/settings';

// The caller's credentials record, newest first, optionally only for some places
export const GET = apiHandler(async ({ url, locals }) => {
  const { session, uploadLog } = operationContext(locals);
  const placeIds = url.searchParams.get('placeIds')?.split(',').filter(Boolean);
  return json({ credentials: await credentialsFor(uploadLog, session, placeIds, getSettings().dataTtlSeconds) });
});
