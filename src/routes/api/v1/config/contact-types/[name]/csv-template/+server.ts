import { getContactType } from '$lib/server/config';
import { ApiError } from '$lib/server/errors';
import { apiHandler, requireParam } from '$lib/server/http';
import { templateCsv } from '$lib/server/staged/csv';

export const GET = apiHandler(async ({ params, url }) => {
	const kind = url.searchParams.get('kind') ?? 'create';
	if (kind !== 'create' && kind !== 'replace' && kind !== 'move' && kind !== 'merge' && kind !== 'delete') {
		throw new ApiError(422, 'NOT_YET_SUPPORTED', `CSV templates for "${kind}" aren't available yet`);
	}
	const contactType = getContactType(requireParam(params.name), kind);
	return new Response(templateCsv(contactType, kind), {
		headers: {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': `attachment; filename="${contactType.name}-${kind}.csv"`
		}
	});
});
