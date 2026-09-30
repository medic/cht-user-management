import { json } from '@sveltejs/kit';
import { z } from 'zod';

import { assertConfigVersion } from '$lib/server/config';
import { ApiError } from '$lib/server/errors';
import { deleteRequest } from '$lib/server/hierarchy/delete';
import { moveRequest } from '$lib/server/hierarchy/move';
import { mergeRequest } from '$lib/server/hierarchy/merge';
import { getJob, scheduleJob, view } from '$lib/server/hierarchy/service';
import { apiHandler, jobDeps, parseWith, readJson } from '$lib/server/http';
import { jobId as jobIdSchema, newJobId } from '$lib/server/places/schemas';

const kindOnly = z.object({ kind: z.string() }).passthrough();

export const GET = apiHandler(async ({ params, locals }) => {
	const deps = jobDeps(locals);
	return json(await view(deps.store, await getJob(deps, parseWith(jobIdSchema, params.jobId))));
});

// Schedules a move, merge or delete; the same jobId returns the job it already scheduled
export const PUT = apiHandler(async ({ params, request, locals }) => {
	assertConfigVersion(request.headers.get('x-config-version'));
	const jobId = parseWith(newJobId, params.jobId);
	const body = await readJson(request);
	const { kind } = parseWith(kindOnly, body);
	if (kind !== 'delete' && kind !== 'move' && kind !== 'merge') {
		throw new ApiError(422, 'UNKNOWN_KIND', `"${kind}" isn't a job that can be scheduled: move, merge or delete`);
	}
	const deps = jobDeps(locals);
	const scheduling = kind === 'move' ? parseWith(moveRequest, body) : kind === 'merge' ? parseWith(mergeRequest, body) : parseWith(deleteRequest, body);
	const { status, job } = await scheduleJob(deps, jobId, scheduling);
	return json(await view(deps.store, job), { status });
});
