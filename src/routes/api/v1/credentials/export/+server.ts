import { getJob } from '$lib/server/hierarchy/service';
import { apiHandler, jobDeps, operationContext, stagedDeps } from '$lib/server/http';
import { placesCreatedBy } from '$lib/server/staged/service';
import { credentialsFor } from '$lib/server/places/credentials';

const COLUMNS = ['place', 'person', 'phone', 'username', 'password', 'placeId', 'contactId', 'createdAt'] as const;

// A CSV of logins to hand out. Quoted throughout, and formula-like values prefixed with ' so a
// spreadsheet never runs them. ?upload=<runId> (or "earlier"): the logins one upload in the staged
// list created; ?placeIds=a,b: those places'; neither: every login still on record.
export const GET = apiHandler(async ({ url, locals }) => {
  const { session, uploadLog } = operationContext(locals);
  const upload = url.searchParams.get('upload');
  let placeIds = url.searchParams.get('placeIds')?.split(',').filter(Boolean);
  let day = new Date().toISOString().slice(0, 10);
  if (upload) {
    const created = await placesCreatedBy(stagedDeps(locals), upload);
    placeIds = created.placeIds;
    // named after the upload, so each group's file is told apart
    if (created.startedAt) day = created.startedAt.slice(0, 16).replace(':', '');
  }
  let rows = placeIds && !placeIds.length ? [] : await credentialsFor(uploadLog, session, placeIds);
  // ?job=<restore job>: the logins an undo recreated
  const jobId = url.searchParams.get('job');
  if (jobId) {
    const job = await getJob(jobDeps(locals), jobId);
    const recreated = new Set((job.result?.loginsRecreated ?? []).map((login) => login.username));
    rows = rows.filter((row) => row.username && recreated.has(row.username));
    day = `undo-${day}`;
  }

  const cell = (value: unknown) => {
    let text = value === undefined || value === null ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(text)) {
      text = `'${text}`;
    }
    return `"${text.replace(/"/g, '""')}"`;
  };
  const csv = [COLUMNS.join(','), ...rows.map((row) => COLUMNS.map((column) => cell(row[column])).join(','))].join('\r\n');

  return new Response(csv + '\r\n', {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="credentials-${day}.csv"`,
      'Cache-Control': 'no-store'
    }
  });
});
