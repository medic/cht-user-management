import { json } from '@sveltejs/kit';

import { apiHandler, operationContext } from '$lib/server/http';

export const GET = apiHandler(async ({ locals }) => {
	const { session, uploadLog } = operationContext(locals);
	const records = await uploadLog.list(session);
	return json({
		records: records.map((record) => ({
			placeId: record.credentials.placeId,
			contactType: record.contactType,
			place: record.place,
			person: record.person,
			phone: record.phone,
			hierarchy: record.hierarchy,
			credentials: {
				username: record.credentials.username,
				password: record.credentials.password,
				contactId: record.credentials.contactId,
				createdAt: record.credentials.created_at
			}
		}))
	});
});
