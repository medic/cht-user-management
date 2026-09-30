import { z } from 'zod';

import { loginWithSso } from '$lib/server/auth/cht-login';
import { completeSignIn, deliverSchema, requireInstance } from '$lib/server/auth/sign-in';
import { apiHandler, parseWith, readJson } from '$lib/server/http';
import { getSettings } from '$lib/server/settings';

const ssoRequest = z
	.object({
		instance: z.string().min(1),
		accessToken: z.string().default(''),
		deliver: deliverSchema
	})
	.strict();

export const POST = apiHandler(async ({ request, cookies }) => {
	const body = parseWith(ssoRequest, await readJson(request));
	const settings = getSettings();
	const instance = requireInstance(settings, body.instance);
	const session = await loginWithSso(instance, body.accessToken, {
		fetch,
		allowAdminLogin: settings.allowAdminLogin
	});
	return completeSignIn(cookies, settings, instance, session, body.deliver);
});
