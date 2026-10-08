import { json } from '@sveltejs/kit';

import { apiHandler, parseWith, readJson, requireParam, stagedDeps } from '$lib/server/http';
import { assertConfigVersion } from '$lib/server/config';
import { editItem, editItemBody, getItem, removeItem } from '$lib/server/staged/service';

export const GET = apiHandler(async ({ params, locals }) => json(await getItem(stagedDeps(locals), requireParam(params.id))));

export const PATCH = apiHandler(async ({ params, request, locals }) => {
  assertConfigVersion(request.headers.get('x-config-version'));
  const body = parseWith(editItemBody, await readJson(request));
  return json(await editItem(stagedDeps(locals), requireParam(params.id), body));
});

export const DELETE = apiHandler(async ({ params, locals }) => {
  await removeItem(stagedDeps(locals), requireParam(params.id));
  return new Response(null, { status: 204 });
});
