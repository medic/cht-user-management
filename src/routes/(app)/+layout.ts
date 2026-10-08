import { redirect } from '@sveltejs/kit';

import { api, isSignedOut, signInUrl, type ContactTypesConfig, type SessionInfo } from '$lib/api';
import type { LayoutLoad } from './$types';

// Every page in this group needs a session; without one, go to login and come back here afterwards
export const load: LayoutLoad = async ({ fetch, url }) => {
  let session: SessionInfo;
  let config: ContactTypesConfig;
  try {
    [session, config] = await Promise.all([
      api<SessionInfo>(fetch, '/auth/session'),
      api<ContactTypesConfig>(fetch, '/config/contact-types')
    ]);
  } catch (e) {
    if (isSignedOut(e)) {
      redirect(303, signInUrl(url));
    }
    throw e;
  }
  return { session, config };
};
