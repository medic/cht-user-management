import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';

import { getJob, jobArchive } from '$lib/server/hierarchy/service';
import { apiHandler, jobDeps, parseWith } from '$lib/server/http';
import { docId } from '$lib/server/places/schemas';

// Every doc a delete removed, as it was: one JSON doc per line, gzipped, while the archive is kept
export const GET = apiHandler(async ({ params, locals }) => {
	const deps = jobDeps(locals);
	const job = await getJob(deps, parseWith(docId, params.jobId));
	const path = jobArchive(deps.settings, job);
	return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, {
		headers: {
			'Content-Type': 'application/gzip',
			'Content-Disposition': `attachment; filename="deleted-${job.id}.ndjson.gz"`,
			'Cache-Control': 'no-store'
		}
	});
});
