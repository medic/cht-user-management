import { json } from '@sveltejs/kit';

import { apiHandler } from '$lib/server/http';
import { getSettings } from '$lib/server/settings';

// Public: the sign-in screen lists these, sorted by host. Hosts aren't exposed.
export const GET = apiHandler(async () => {
  const byHost = [...getSettings().instances].sort((a, b) => a.host.localeCompare(b.host, 'en', { numeric: true }));
  return json({ instances: byHost.map(({ id, name }) => ({ id, name })) });
});
