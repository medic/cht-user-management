import { json } from '@sveltejs/kit';

import { assertConfigVersion } from '$lib/server/config';
import { ApiError } from '$lib/server/errors';
import { apiHandler, stagedDeps } from '$lib/server/http';
import { stageCsv } from '$lib/server/staged/csv';

const MAX_BYTES = 5 * 1024 * 1024;

// multipart/form-data: file, kind, contactType. Rows are staged at once and checked in the background
export const POST = apiHandler(async ({ request, locals }) => {
  assertConfigVersion(request.headers.get('x-config-version'));
  let form: FormData;
  try {
    form = await request.formData();
  } catch (e) {
    // the Node adapter refuses a body over BODY_SIZE_LIMIT (512 KB unless set) before it's read
    if ((e as { status?: number }).status === 413) {
      throw new ApiError(
        413,
        'CSV_TOO_LARGE',
        "The file is larger than this server accepts. Split it, or raise the server's BODY_SIZE_LIMIT."
      );
    }
    throw new ApiError(400, 'INVALID_REQUEST', 'send the file as multipart/form-data');
  }

  const file = form.get('file');
  const kind = String(form.get('kind') ?? 'create');
  const contactType = String(form.get('contactType') ?? '');
  if (!(file instanceof File) || !contactType) {
    throw new ApiError(400, 'INVALID_REQUEST', 'a file and a contactType are required');
  }
  if (kind !== 'create' && kind !== 'replace' && kind !== 'move' && kind !== 'merge' && kind !== 'delete') {
    throw new ApiError(
      422,
      'NOT_YET_SUPPORTED',
      `"${kind}" files can't be imported yet; only "create", "replace", "move", "merge" and "delete" are supported`
    );
  }
  if (file.size > MAX_BYTES) {
    throw new ApiError(413, 'CSV_TOO_LARGE', 'The file is larger than 5 MB. Split it and upload each part.');
  }

  const result = await stageCsv(stagedDeps(locals), { fileName: file.name || 'upload.csv', text: await file.text(), contactType, kind });
  return json(result, { status: 202 });
});
