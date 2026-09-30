import type { Handle, ServerInit } from '@sveltejs/kit';

import { authenticate } from '$lib/server/auth/authenticate';
import { authError } from '$lib/server/auth/errors';
import { presentedToken, SESSION_COOKIE } from '$lib/server/auth/session';
import { errorResponse } from '$lib/server/http';
import { getRevocations, startJobRunner } from '$lib/server/runtime';
import { checkDeployment } from '$lib/server/config';
import { setMaxPlacesLoaded } from '$lib/server/places/lookup';
import { getSettings } from '$lib/server/settings';

// Refuse to start when a setting or the deployment's folder is missing or invalid (APP.md → Auth →
// Configuration)
export const init: ServerInit = async () => {
	setMaxPlacesLoaded(getSettings().maxPlacesLoaded);
	await checkDeployment();
	startJobRunner();
};

// the dev server reloads this module on changes without calling init again: redo what it set up
if (import.meta.env.DEV) {
	setMaxPlacesLoaded(getSettings().maxPlacesLoaded);
	startJobRunner();
}

const PUBLIC_PATHS = new Set(['/api/v1/config/instances', '/api/v1/config/logo', '/api/v1/auth/login', '/api/v1/auth/sso']);

export const handle: Handle = async ({ event, resolve }) => {
	const { pathname } = event.url;
	if (!pathname.startsWith('/api/') || PUBLIC_PATHS.has(pathname)) {
		return resolve(event);
	}

	try {
		const token = presentedToken(event.request.headers.get('authorization'), event.cookies.get(SESSION_COOKIE));
		if (!token) {
			throw authError('UNAUTHENTICATED', 'sign in first');
		}
		const settings = getSettings();
		event.locals.auth = await authenticate(token, {
			cookieKey: settings.cookieKey,
			revocations: getRevocations(),
			instances: settings.instances
		});
	} catch (e) {
		return errorResponse(e);
	}

	return resolve(event);
};
