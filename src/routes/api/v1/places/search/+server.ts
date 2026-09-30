import { json } from '@sveltejs/kit';
import { z } from 'zod';

import { apiHandler, operationContext, parseWith } from '$lib/server/http';
import { searchPlaces } from '$lib/server/places/directory';

const searchQuery = z.object({
  type: z.string().min(1),
  q: z.string().optional(),
  parentId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20)
});

// Place names for the hierarchy fields and place pickers, within the caller's facilities
export const GET = apiHandler(async ({ url, locals }) => {
  const query = parseWith(searchQuery, Object.fromEntries(url.searchParams));
  const { cht, session } = operationContext(locals);
  return json({ places: await searchPlaces(cht, session, query) });
});
