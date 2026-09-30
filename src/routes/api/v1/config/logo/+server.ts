import { apiHandler } from '$lib/server/http';
import { deploymentLogo } from '$lib/server/config';
import { ApiError } from '$lib/server/errors';

// Public: the sign-in screen shows it. Browsers keep it, but check its ETag on each use (a 304), so
// a server switched to another deployment never shows the old logo
export const GET = apiHandler(async ({ request }) => {
	const logo = deploymentLogo();
	if (!logo) {
		throw new ApiError(404, 'NO_LOGO', 'this deployment has no logo');
	}
	const headers = { etag: logo.etag, 'cache-control': 'public, no-cache' };
	if (request.headers.get('if-none-match') === logo.etag) {
		return new Response(null, { status: 304, headers });
	}
	return new Response(logo.bytes, { headers: { ...headers, 'content-type': logo.contentType } });
});
