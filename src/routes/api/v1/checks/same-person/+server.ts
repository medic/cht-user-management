import { json } from '@sveltejs/kit';

import { apiHandler, parseWith, readJson, stagedDeps } from '$lib/server/http';
import { findSamePerson, samePersonQuery } from '$lib/server/staged/service';

// The read-only check the create form runs once the person's fields are valid: is this a person
// already in the staged list? (APP.md → One person, many places)
export const POST = apiHandler(async ({ request, locals }) =>
  json(await findSamePerson(stagedDeps(locals), parseWith(samePersonQuery, await readJson(request))))
);
