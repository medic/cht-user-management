import { getJob } from '$lib/server/hierarchy/service';
import { apiHandler, jobDeps, parseWith } from '$lib/server/http';
import { jobId } from '$lib/server/places/schemas';

// The job's full output, including cht-conf's
export const GET = apiHandler(async ({ params, locals }) => {
  const deps = jobDeps(locals);
  const job = await getJob(deps, parseWith(jobId, params.jobId));
  const lines = await deps.store.log(job.instanceId, job.id);
  return new Response(lines.join('\n') + '\n', { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
});
