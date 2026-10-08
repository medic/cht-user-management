import { json } from '@sveltejs/kit';

import { apiHandler, parseWith, readJson, stagedDeps } from '$lib/server/http';
import { confirmMany, confirmManyBody } from '$lib/server/staged/service';

// Bulk confirm; merges and deletes are skipped, since each needs its name typed
export const POST = apiHandler(async ({ request, locals }) => {
  const { ids } = parseWith(confirmManyBody, await readJson(request));
  return json(await confirmMany(stagedDeps(locals), ids));
});
