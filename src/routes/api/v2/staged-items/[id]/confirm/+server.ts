import { json } from '@sveltejs/kit';

import { apiHandler, parseWith, readJson, requireParam, stagedDeps } from '$lib/server/http';
import { confirmItem, confirmItemBody } from '$lib/server/staged/service';

export const POST = apiHandler(async ({ params, request, locals }) => {
  const body = parseWith(confirmItemBody, await readJson(request));
  return json(await confirmItem(stagedDeps(locals), requireParam(params.id), body));
});
