import { json } from '@sveltejs/kit';
import { z } from 'zod';

import { formatValue } from '$lib/validation/validators';
import { getContactType } from '$lib/server/config';
import { apiHandler, operationContext, parseWith, readJson } from '$lib/server/http';
import { uniquePropertyMatches } from '$lib/server/places/unique';

const duplicatesRequest = z
  .object({
    contactType: z.string().min(1),
    parentId: z.string().min(1),
    placeId: z.string().optional(),
    place: z.record(z.string(), z.string())
  })
  .strict();

// The read-only duplicate check the create form runs before adding (APP.md → Creating one user, step 5)
export const POST = apiHandler(async ({ request, locals }) => {
  const body = parseWith(duplicatesRequest, await readJson(request));
  const contactType = getContactType(body.contactType);
  const values = Object.fromEntries(
    contactType.place_properties
      .filter((p) => p.unique && body.place[p.property_name])
      // a generated value, like a CHP area's name, arrives already rendered
      .map((p) => [p.property_name, p.type === 'generated' ? body.place[p.property_name] : formatValue(p, body.place[p.property_name])])
  );
  const { cht } = operationContext(locals);
  const warnings = await uniquePropertyMatches(cht, contactType, { placeId: body.placeId ?? '', parentId: body.parentId, values });
  return json({ warnings });
});
