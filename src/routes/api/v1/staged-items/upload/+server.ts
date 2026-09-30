import { json } from '@sveltejs/kit';

import { apiHandler, parseWith, stagedDeps } from '$lib/server/http';
import { startUpload, uploadBody } from '$lib/server/staged/service';

// Starts uploading in the background; progress shows on the items and in GET /staged-items → upload
export const POST = apiHandler(async ({ request, locals }) => {
  const text = await request.text();
  const { ids } = parseWith(uploadBody, text ? safeJson(text) : {});
  return json(await startUpload(stagedDeps(locals), ids), { status: 202 });
});

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
