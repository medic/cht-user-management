import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { within } from './paths';
import { jobId, newJobId } from './places/schemas';

describe('within', () => {
	it('builds paths inside the folder', () => {
		expect(within('/tmp/jobs', 'job-1')).toBe(resolve('/tmp/jobs/job-1'));
		expect(within('data/archives', 'ke', 'job-1.ndjson.gz')).toBe(join(resolve('data/archives'), 'ke', 'job-1.ndjson.gz'));
	});

	it('refuses parts that lead to the folder itself or outside it', () => {
		for (const id of ['..', '.', '', '../app', '../../app', 'a/../../b', '/etc']) {
			expect(() => within('/tmp/jobs', id), id).toThrow(/would lead outside/);
		}
		// a doc id with a path in it, when a restore names files after ids
		expect(() => within('/tmp/jobs/job-1/json_docs', '../../x.doc.json')).toThrow(/would lead outside/);
	});
});

describe('job ids', () => {
	it('are UUIDs, and an undo is its delete’s UUID with "-undo"', () => {
		const id = crypto.randomUUID();
		expect(newJobId.parse(id)).toBe(id);
		expect(jobId.parse(`${id}-undo`)).toBe(`${id}-undo`);
		// an undo's id is only ever made by the server
		expect(newJobId.safeParse(`${id}-undo`).success).toBe(false);
	});

	it('refuse anything else, including whatever could name a path or another Redis key', () => {
		const id = crypto.randomUUID();
		for (const bad of ['../../app', '..', 'a/b', 'a%2Fb', `${id}:log`, `${id}/..`, `../${id}`, 'job-1', '_design', `${id} `, '']) {
			expect(newJobId.safeParse(bad).success, bad).toBe(false);
			expect(jobId.safeParse(bad).success, bad).toBe(false);
		}
	});
});
