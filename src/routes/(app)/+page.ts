import { api } from '$lib/api';
import type { StagedList } from '$lib/staged';
import type { PageLoad } from './$types';

// Filters live in the URL, so a filtered list can be bookmarked and the back button works
export const load: PageLoad = async ({ fetch, url, depends }) => {
  depends('app:staged');
  const query = new URLSearchParams();
  for (const key of ['status', 'kind', 'q', 'file']) {
    const value = url.searchParams.get(key);
    if (value) {
      query.set(key, value);
    }
  }
  const list = await api<StagedList>(fetch, `/staged-items${query.size ? `?${query}` : ''}`);
  return {
    list,
    filters: { status: query.get('status') ?? '', kind: query.get('kind') ?? '', q: query.get('q') ?? '', file: query.get('file') ?? '' }
  };
};
