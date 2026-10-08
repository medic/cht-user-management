import { json } from '@sveltejs/kit';
import { z } from 'zod';

import { apiHandler, operationContext, parseWith } from '$lib/server/http';
import { searchPeople } from '$lib/server/places/replace-lookups';

const searchQuery = z.object({
  type: z.string().min(1),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20)
});

// People who could take over a place of a type, for the replace form's "someone already here"
export const GET = apiHandler(async ({ url, locals }) => {
  const query = parseWith(searchQuery, Object.fromEntries(url.searchParams));
  const { cht, session } = operationContext(locals);
  return json({ people: await searchPeople(cht, session, query) });
});
