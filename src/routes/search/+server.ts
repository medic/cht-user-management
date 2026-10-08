import { operationContext } from '$lib/server/http';
import { legacyContactType, legacyHandler } from '$lib/server/legacy/http';
import { hierarchyWithReplacement } from '$lib/server/legacy/resolver';
import { clearPlaceCache } from '$lib/server/places/lookup';

// POST /search?type=…&level=…&clear_cache=1: the previous version's search box, which clients such as
// Kenya's CHW registry call to have the places of the caller's instance read again. The search
// results it rendered aren't used by them, so nothing is rendered
export const POST = legacyHandler(async ({ url, locals }) => {
  const contactType = legacyContactType(url.searchParams.get('type'));
  const level = parseInt(url.searchParams.get('level') ?? '');
  if (!hierarchyWithReplacement(contactType).some((hierarchy) => hierarchy.level === level)) {
    throw new Error(`not hierarchy constraint at ${level}`);
  }

  if (parseInt(url.searchParams.get('clear_cache') ?? '') === 1) {
    clearPlaceCache(operationContext(locals).cht.domain);
  }
  return new Response('', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
});
