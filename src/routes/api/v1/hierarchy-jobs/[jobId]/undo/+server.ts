import { json } from '@sveltejs/kit';

import { undoBody } from '$lib/server/hierarchy/restore';
import { undoJob, undoPreview, view } from '$lib/server/hierarchy/service';
import { apiHandler, jobDeps, parseWith, readJson } from '$lib/server/http';
import { jobId } from '$lib/server/places/schemas';

// What undoing this delete would restore, and whose accounts it affected
export const GET = apiHandler(async ({ params, locals }) => json(await undoPreview(jobDeps(locals), parseWith(jobId, params.jobId))));

// Schedules the undo: a restore job, run like any other. recreateLogins: new logins for the accounts
// the delete disabled
export const POST = apiHandler(async ({ params, request, locals }) => {
  const deps = jobDeps(locals);
  const { recreateLogins } = parseWith(undoBody, await readJson(request));
  const { status, job } = await undoJob(deps, parseWith(jobId, params.jobId), { recreateLogins });
  return json(await view(deps.store, job), { status });
});
