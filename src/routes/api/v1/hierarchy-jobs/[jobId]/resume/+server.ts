import { json } from '@sveltejs/kit';

import { resumeJob, view } from '$lib/server/hierarchy/service';
import { apiHandler, jobDeps, parseWith } from '$lib/server/http';
import { jobId } from '$lib/server/places/schemas';

// A job waiting for sign-in, or one that failed, goes back in line with the caller's current session
export const POST = apiHandler(async ({ params, locals }) => {
	const deps = jobDeps(locals);
	return json(await view(deps.store, await resumeJob(deps, parseWith(jobId, params.jobId))));
});
