import { json } from '@sveltejs/kit';

import { assertConfigVersion } from '$lib/server/config';
import { ApiError } from '$lib/server/errors';
import { apiHandler, parseWith, readJson, stagedDeps } from '$lib/server/http';
import { addItem, addItemBody, clearFinished, listItems, listQuery } from '$lib/server/staged/service';

export const GET = apiHandler(async ({ url, locals }) => {
  const query = parseWith(listQuery, Object.fromEntries(url.searchParams));
  return json(await listItems(stagedDeps(locals), query));
});

export const POST = apiHandler(async ({ request, locals }) => {
  assertConfigVersion(request.headers.get('x-config-version'));
  const body = parseWith(addItemBody, await readJson(request));
  return json(await addItem(stagedDeps(locals), body), { status: 201 });
});

// DELETE /staged-items?status=created clears finished items
export const DELETE = apiHandler(async ({ url, locals }) => {
  if (url.searchParams.get('status') !== 'created') {
    throw new ApiError(400, 'INVALID_REQUEST', 'only finished items can be cleared in bulk: DELETE /staged-items?status=created');
  }
  return json(await clearFinished(stagedDeps(locals)));
});
