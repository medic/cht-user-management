import { json } from '@sveltejs/kit';
import { z } from 'zod';

import { ApiError } from '$lib/server/errors';
import { deleteRequest, previewDelete } from '$lib/server/hierarchy/delete';
import { moveRequest, previewMove } from '$lib/server/hierarchy/move';
import { mergeRequest, previewMerge } from '$lib/server/hierarchy/merge';
import { apiHandler, jobDeps, operationContext, parseWith, readJson } from '$lib/server/http';
import { previewReplace } from '$lib/server/places/replace-lookups';
import { docId, replaceRequest } from '$lib/server/places/schemas';

const previewBody = z.object({ kind: z.string(), request: z.record(z.string(), z.unknown()) }).strict();

// What an operation would do, without doing it (docs/api-contract.md → POST /preview)
export const POST = apiHandler(async ({ request, locals }) => {
	const body = parseWith(previewBody, await readJson(request));
	if (body.kind === 'merge') {
		const { cht, session, store } = jobDeps(locals);
		const request = parseWith(mergeRequest.extend({ confirmName: z.string().optional(), jobId: docId.optional() }), { kind: 'merge', ...body.request });
		return json(await previewMerge(cht, session, store, request));
	}
	if (body.kind === 'move') {
		const { cht, session, store } = jobDeps(locals);
		const request = parseWith(moveRequest.extend({ jobId: docId.optional(), acceptLarge: z.boolean().optional() }), { kind: 'move', ...body.request });
		return json(await previewMove(cht, session, store, request));
	}
	if (body.kind === 'delete') {
		const { cht, session, store } = jobDeps(locals);
		const request = parseWith(deleteRequest.extend({ confirmName: deleteRequest.shape.confirmName.optional(), jobId: docId.optional() }), { kind: 'delete', ...body.request });
		return json(await previewDelete(cht, session, store, request));
	}
	if (body.kind !== 'replace') {
		throw new ApiError(422, 'NOT_YET_SUPPORTED', `previews for "${body.kind}" aren't supported yet`);
	}
	const { placeId, ...replace } = parseWith(replaceRequest.extend({ placeId: docId }), body.request);
	return json(await previewReplace(operationContext(locals), placeId, replace));
});
