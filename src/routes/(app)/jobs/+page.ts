import { api, type JobView } from '$lib/api';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, depends }) => {
	depends('app:jobs');
	return { jobs: (await api<{ jobs: JobView[] }>(fetch, '/hierarchy-jobs')).jobs };
};
