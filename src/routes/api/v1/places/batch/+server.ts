import { json } from '@sveltejs/kit';

import { apiHandler, operationContext, parseWith, readJson } from '$lib/server/http';
import { runBatch } from '$lib/server/places/batch';
import { batchRequest } from '$lib/server/places/schemas';
import { getSettings } from '$lib/server/settings';

export const POST = apiHandler(async ({ request, locals }) => {
  const body = parseWith(batchRequest, await readJson(request));
  return json(await runBatch(operationContext(locals), body, getSettings().batchMaxItems), { status: 207 });
});
