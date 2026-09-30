import { json } from '@sveltejs/kit';

import { assertConfigVersion } from '$lib/server/config';
import { apiHandler, operationContext, parseWith, readJson } from '$lib/server/http';
import { createPlace } from '$lib/server/places/create';
import { placeDetail } from '$lib/server/places/directory';
import { createRequest, docId } from '$lib/server/places/schemas';

export const GET = apiHandler(async ({ params, locals }) => {
	const { cht, session } = operationContext(locals);
	return json(await placeDetail(cht, session, parseWith(docId, params.placeId)));
});

export const PUT = apiHandler(async ({ params, request, locals }) => {
	assertConfigVersion(request.headers.get('x-config-version'));
	const placeId = parseWith(docId, params.placeId);
	const body = parseWith(createRequest, await readJson(request));
	const result = await createPlace(operationContext(locals), placeId, body);
	return json(result.body, { status: result.status });
});
