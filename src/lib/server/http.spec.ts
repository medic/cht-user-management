import { describe, expect, it } from 'vitest';

import { ChtError } from './errors';
import { toErrorBody } from './http';

describe('toErrorBody', () => {
	it('treats CHT rejecting the stored session as an ended session, whether expired or malformed', () => {
		for (const error of [
			new ChtError(401, 'You are not authorized to access this db.'),
			// what CouchDB actually answers for a malformed AuthSession cookie
			new ChtError(400, '400 - {"error":"bad_request","reason":"Malformed AuthSession cookie. Please clear your cookies."}')
		]) {
			expect(toErrorBody(error)).toMatchObject({ status: 401, body: { error: { code: 'SESSION_EXPIRED' } } });
		}
	});

	it('keeps other CHT failures as retryable upstream errors', () => {
		expect(toErrorBody(new ChtError(503, 'unavailable'))).toMatchObject({ status: 502, body: { error: { code: 'UPSTREAM_FAILED' } } });
		expect(toErrorBody(new ChtError(400, 'invalid doc'))).toMatchObject({ status: 502, body: { error: { code: 'UPSTREAM_FAILED' } } });
	});
});
