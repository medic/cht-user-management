import { json } from '@sveltejs/kit';

import { apiHandler, operationContext, parseWith, readJson } from '$lib/server/http';
import { replacePrimaryContact } from '$lib/server/places/replace';
import { docId, replaceRequest } from '$lib/server/places/schemas';

export const PUT = apiHandler(async ({ params, request, locals }) => {
	const placeId = parseWith(docId, params.placeId);
	const body = parseWith(replaceRequest, await readJson(request));
	const result = await replacePrimaryContact(operationContext(locals), placeId, body);
	return json(result.body, { status: result.status });
});
