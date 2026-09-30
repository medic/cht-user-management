import { redirect } from '@sveltejs/kit';

import { api, safeNext, type Instance, type SessionInfo } from '$lib/api';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, url }) => {
	const next = safeNext(url.searchParams.get('next'));

	const signedIn = await api<SessionInfo>(fetch, '/auth/session').then(
		() => true,
		() => false
	);
	if (signedIn) {
		redirect(303, next);
	}

	try {
		const { instances } = await api<{ instances: Instance[] }>(fetch, '/config/instances');
		return { instances, next, loadError: null };
	} catch (e) {
		return { instances: [] as Instance[], next, loadError: (e as Error).message };
	}
};
