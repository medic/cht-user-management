import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import { HttpCht, isRetryable, isUpdateConflict } from './client';

let server: Server | undefined;

afterEach(async () => {
	await new Promise((resolve) => (server ? server.close(resolve) : resolve(undefined)));
	server = undefined;
});

// A local server answering every request with the same response, counting them
async function answering(status: number, body: unknown): Promise<{ cht: HttpCht; requests: () => number }> {
	let count = 0;
	server = createServer((_req, res) => {
		count++;
		res.writeHead(status, { 'content-type': 'application/json' });
		res.end(JSON.stringify(body));
	});
	await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
	const { port } = server.address() as AddressInfo;
	return { cht: new HttpCht({ domain: `127.0.0.1:${port}`, useHttp: true, sessionCookie: 'AuthSession=abc' }), requests: () => count };
}

describe('document update conflicts', () => {
	it('are reported, never re-sent blindly, even when CHT answers 500', async () => {
		const { cht, requests } = await answering(500, { error: 'conflict', reason: 'Document update conflict.' });

		const error = await cht.updateUser('jane_doe', { place: ['place-1'] }).then(
			() => undefined,
			(e) => e
		);

		expect(isUpdateConflict(error)).toBe(true);
		expect(isRetryable(error)).toBe(false);
		// re-sending the same place list could undo another write; callers retry from a fresh read
		expect(requests()).toBe(1);
	});

	it('are recognised as a 409 too', async () => {
		const { cht } = await answering(409, { error: 'conflict', reason: 'Document update conflict.' });
		const error = await cht.putDoc({ _id: 'x' }).then(
			() => undefined,
			(e) => e
		);
		expect(isUpdateConflict(error)).toBe(true);
	});
});
