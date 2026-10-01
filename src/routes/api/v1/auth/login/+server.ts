import { z } from 'zod';

import { loginWithPassword } from '$lib/server/auth/cht-login';
import { completeSignIn, deliverSchema, requireInstance } from '$lib/server/auth/sign-in';
import { apiHandler, parseWith, readJson } from '$lib/server/http';
import { getSettings } from '$lib/server/settings';

// Empty credentials are MISSING_CREDENTIALS, not a malformed request, so they're allowed through here
const loginRequest = z
  .object({
    instance: z.string().min(1),
    username: z.string().default(''),
    password: z.string().default(''),
    deliver: deliverSchema
  })
  .strict();

export const POST = apiHandler(async ({ request, cookies }) => {
  const body = parseWith(loginRequest, await readJson(request));
  const settings = getSettings();
  const instance = requireInstance(settings, body.instance);
  const session = await loginWithPassword(instance, body.username, body.password, {
    fetch,
    allowAdminLogin: settings.allowAdminLogin
  });
  return completeSignIn(cookies, settings, instance, session, body.deliver);
});
