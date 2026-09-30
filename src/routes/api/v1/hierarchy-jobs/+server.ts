import { json } from '@sveltejs/kit';
import { z } from 'zod';

import { apiHandler, jobDeps, parseWith } from '$lib/server/http';
import { JOB_KINDS, JOB_STATUSES } from '$lib/server/hierarchy/jobs';
import { listJobs } from '$lib/server/hierarchy/service';

const listQuery = z.object({ status: z.enum(JOB_STATUSES).optional(), kind: z.enum(JOB_KINDS).optional() });

// The caller's hierarchy jobs, newest first
export const GET = apiHandler(async ({ url, locals }) => {
  const filter = parseWith(listQuery, Object.fromEntries(url.searchParams));
  return json({ jobs: await listJobs(jobDeps(locals), filter) });
});
