import { json } from '@sveltejs/kit';

import { describeSession } from '$lib/server/auth/session';
import { apiHandler, requireAuth } from '$lib/server/http';

export const GET = apiHandler(async ({ locals }) => json(describeSession(requireAuth(locals))));
