import { baseUrl } from '$lib/server/auth/instances';
import { apiHandler, clearSessionCookie, requireAuth } from '$lib/server/http';
import { getRevocations } from '$lib/server/runtime';

// APP.md → Session lifetime and logout: revoking the token is what ends access. CouchDB sessions
// are stateless, so DELETE _session only asks CHT to clear its cookie, and is done best-effort.
export const POST = apiHandler(async ({ locals, cookies }) => {
	const { session, instance, jti, expiresAt } = requireAuth(locals);
	await getRevocations().revoke(jti, expiresAt);
	clearSessionCookie(cookies);

	fetch(new URL('_session', baseUrl(instance)), {
		method: 'DELETE',
		headers: { Cookie: session.sessionCookie },
		signal: AbortSignal.timeout(5000)
	}).catch(() => undefined);

	return new Response(null, { status: 204 });
});
