import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Instance } from '../auth/instances';
import type { Session } from '../auth/session';
import { ApiError } from '../errors';
import type { JobSettings } from '../settings';
import { stageCsv } from '../staged/csv';
import { addItem, confirmItem, confirmMany, listItems, listQuery, startUpload, type StagedDeps } from '../staged/service';
import { MemoryStagedStore } from '../staged/store';
import { MemoryUploadTracker } from '../staged/upload-tracker';
import { fakeChtConf } from '../testing/fake-cht-conf';
import { FakeCht } from '../testing/fake-cht';
import { archivePath, readArchive } from './delete';
import { MemoryJobStore } from './jobs';
import { previewMerge } from './merge';
import { JobRunner } from './runner';
import { jobArchive, scheduleJob, type JobDeps } from './service';

const CHU = 'c_community_health_unit';
const AREA = 'd_community_health_volunteer_area';
const instance: Instance = { id: 'test', name: 'Test', host: 'fake.cht', useHttp: false, idpOrigins: [] };
const session: Session = { instanceId: 'test', username: 'manager', facilityIds: ['*'], sessionCookie: 'AuthSession=abc', chtVersion: '4.18.0', isAdmin: true };
const WORKER_KEY = 'w'.repeat(40);
const lineage = (...ids: string[]) => ids.reduceRight<any>((parent, id) => ({ _id: id, ...(parent ? { parent } : {}) }), undefined);

let cht: FakeCht;
let store: MemoryJobStore;
let dir: string;
let settings: JobSettings;
let deps: JobDeps;

// Kisumu West › Kanyakwar (CHA Jane, with Mary Area) merges into Seme › Kogony (CHA Paul)
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'cht-iam-merge-'));
	settings = {
		maxSentinelBacklog: 7000,
		recheckSeconds: 900,
		ttlSeconds: 86_400,
		workDir: join(dir, 'work'),
		archiveDir: join(dir, 'archives'),
		archiveTtlSeconds: 86_400,
		timeoutSeconds: 60,
		chtConfHeapMb: 256
	};
	cht = new FakeCht().seed(
		{ _id: 'county', type: 'contact', contact_type: 'a_county', name: 'Kisumu' },
		{ _id: 'west', type: 'contact', contact_type: 'b_sub_county', name: 'Kisumu West', parent: lineage('county') },
		{ _id: 'seme', type: 'contact', contact_type: 'b_sub_county', name: 'Seme', parent: lineage('county') },
		{ _id: 'kanyakwar', type: 'contact', contact_type: CHU, name: 'Kanyakwar', code: '111111', parent: lineage('west', 'county'), contact: { _id: 'jane' } },
		{ _id: 'jane', type: 'person', name: 'Jane', parent: lineage('kanyakwar', 'west', 'county') },
		{ _id: 'area', type: 'contact', contact_type: AREA, name: 'Mary Area', parent: lineage('kanyakwar', 'west', 'county') },
		{ _id: 'mary', type: 'person', name: 'Mary', parent: lineage('area', 'kanyakwar', 'west', 'county') },
		{ _id: 'kogony', type: 'contact', contact_type: CHU, name: 'Kogony', code: '222222', parent: lineage('seme', 'county'), contact: { _id: 'paul' } },
		{ _id: 'paul', type: 'person', name: 'Paul', parent: lineage('kogony', 'seme', 'county') },
		{ _id: 'report-unit', type: 'data_record', form: 'visit', place_id: 'kanyakwar' },
		{ _id: 'report-jane', type: 'data_record', form: 'visit', fields: { patient_id: 'jane' } }
	);
	cht.seedUser({ username: 'jane', place: ['kanyakwar'], contact: 'jane', roles: ['community_health_assistant'] });
	cht.seedUser({ username: 'mary', place: ['area'], contact: 'mary', roles: ['community_health_volunteer'] });
	store = new MemoryJobStore();
	deps = { cht, session, store, workerKey: WORKER_KEY, settings };
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const merge = (overrides: Record<string, string> = {}) => ({ kind: 'merge' as const, contactType: CHU, sourceId: 'kanyakwar', destinationId: 'kogony', confirmName: 'Kanyakwar', ...overrides });
const noLog = { log: async () => undefined, list: async () => [] };
const runner = () => new JobRunner({ store, settings, instances: [instance], workerKey: WORKER_KEY, chtFor: () => cht, runChtConf: fakeChtConf(cht), uploadLog: noLog });

async function expectApiError(promise: Promise<unknown>, code: string): Promise<ApiError> {
	const error = await promise.then(() => undefined, (e) => e);
	expect(error).toBeInstanceOf(ApiError);
	expect(error.code).toBe(code);
	return error;
}

describe('before scheduling', () => {
	it('shows what moves, what is lost with the source, whose primary contact merges into whose, and who is affected', async () => {
		const preview = await previewMerge(cht, session, store, merge());

		expect(preview).toMatchObject({
			source: { name: 'Kanyakwar', location: 'Kisumu › Kisumu West › Kanyakwar' },
			destination: { name: 'Kogony', location: 'Kisumu › Seme › Kogony' },
			// Mary Area and Mary move; Jane is merged into Paul
			counts: { places: 1, people: 1 },
			primaryContacts: { source: { id: 'jane', name: 'Jane' }, destination: { id: 'paul', name: 'Paul' } },
			accounts: [{ username: 'jane', action: 'retire', lastSync: null }],
			confirmName: 'Kanyakwar'
		});
		expect(preview.properties).toEqual(expect.arrayContaining([{ name: 'code', label: 'CHU Code', source: '111111', destination: '222222' }]));
	});

	it('only merges different places of the type, never into one under it, with the source’s name typed', async () => {
		await expectApiError(scheduleJob(deps, '00000000-0000-4000-8000-000000000001', merge({ destinationId: 'kanyakwar' })), 'SAME_PLACE');
		await expectApiError(scheduleJob(deps, '00000000-0000-4000-8000-000000000001', merge({ destinationId: 'seme' })), 'PLACE_WRONG_TYPE');
		await expectApiError(scheduleJob(deps, '00000000-0000-4000-8000-000000000001', merge({ confirmName: 'kanyakwar' })), 'CONFIRMATION_REQUIRED');
	});

	it('refuses to take a place above’s primary contact out from under it', async () => {
		cht.docs.get('west')!.contact = { _id: 'mary' };
		const error = await expectApiError(scheduleJob(deps, '00000000-0000-4000-8000-000000000001', merge()), 'PRIMARY_CONTACT_WOULD_LEAVE');
		expect(error.message).toMatch(/^Can't merge Kanyakwar/);
	});
});

describe('running a merge', () => {
	it('has cht-conf merge, keeps a copy first, and records the merge on the destination', async () => {
		await scheduleJob(deps, '00000000-0000-4000-8000-000000000001', merge());

		await runner().tick();

		const done = (await store.get('test', '00000000-0000-4000-8000-000000000001'))!;
		expect(done).toMatchObject({ status: 'done', result: { usersDisabled: 1, usersUpdated: 0 }, archive: { available: true } });
		expect(cht.docs.has('kanyakwar') || cht.docs.has('jane')).toBe(false);
		expect(cht.docs.get('area')?.parent).toEqual(lineage('kogony', 'seme', 'county'));
		expect(cht.docs.get('mary')?.parent).toEqual(lineage('area', 'kogony', 'seme', 'county'));
		expect(cht.docs.get('report-unit')?.place_id).toBe('kogony');
		expect(cht.docs.get('report-jane')?.fields.patient_id).toBe('paul');
		expect(cht.users.get('jane')?.inactive).toBe(true);
		expect(cht.docs.get('kogony')?.user_attribution.merges).toEqual([
			expect.objectContaining({ source: 'kanyakwar', sourceName: 'Kanyakwar', sourcePrimaryContact: 'jane', username: 'manager' })
		]);

		// the copy holds every doc as it was before the merge
		const archived = new Map<string, any>();
		for await (const doc of readArchive(archivePath(settings.archiveDir, done))) archived.set(doc._id, doc);
		expect(archived.get('kanyakwar')).toMatchObject({ name: 'Kanyakwar', code: '111111' });
		expect(archived.get('area')?.parent).toEqual(lineage('kanyakwar', 'west', 'county'));
		// and it can be downloaded, as a delete's can
		expect(jobArchive(settings, done)).toBe(archivePath(settings.archiveDir, done));
	});
});

describe('merge items in the staged list', () => {
	const owner = { instanceId: 'test', username: 'manager' };
	let staged: StagedDeps;
	beforeEach(() => {
		staged = {
			store: new MemoryStagedStore(),
			tracker: new MemoryUploadTracker(),
			validationTracker: new MemoryUploadTracker(),
			context: { cht, session, uploadLog: noLog },
			maxBatch: 100,
			jobs: { store, workerKey: WORKER_KEY, settings }
		};
	});
	async function waitFor(check: () => Promise<boolean>) {
		for (let i = 0; i < 400 && !(await check()); i++) await new Promise((resolve) => setTimeout(resolve, 5));
	}
	const item = (overrides: Record<string, unknown> = {}) => ({
		kind: 'merge' as const,
		request: { jobId: '00000000-0000-4000-8000-000000000001', contactType: CHU, sourceId: 'kanyakwar', destinationId: 'kogony', confirmName: 'Kanyakwar', ...overrides }
	});

	it('adds a confirmed merge from the form, and keeps a delete off its destination', async () => {
		const added = await addItem(staged, item());
		expect(added).toMatchObject({
			status: 'ready',
			claims: ['kanyakwar', 'west', 'county'],
			targets: ['kogony', 'seme', 'county'],
			summary: { title: 'Kanyakwar', subtitle: 'Kisumu › Kisumu West', person: 'Merges into Kogony, with 1 place and 1 person' }
		});
		const deleteDestination = { kind: 'delete' as const, request: { jobId: '00000000-0000-4000-8000-000000000002', contactType: CHU, placeId: 'kogony', confirmName: 'Kogony' } };
		await expectApiError(addItem(staged, deleteDestination), 'DELETE_ALREADY_STAGED');

		await startUpload(staged);
		await waitFor(async () => (await staged.tracker.state(owner)).state === 'idle');
		await runner().tick();
		expect((await listItems(staged, listQuery.parse({}))).items[0]).toMatchObject({ status: 'created', job: { status: 'done' } });
	});

	it('stages CSV rows to wait for the source’s name to be typed, one at a time', async () => {
		const csv = ['"Sub County","Community Health Unit","Into Sub County","Into Community Health Unit"', 'Kisumu West,Kanyakwar,Seme,Kogony'].join('\n');
		await stageCsv(staged, { fileName: 'merges.csv', text: csv, contactType: CHU, kind: 'merge' });
		await waitFor(async () => (await staged.validationTracker.state(owner)).state === 'idle' && (await staged.store.list(owner)).every((i) => i.status !== 'pending'));

		const [row] = (await listItems(staged, listQuery.parse({ file: 'merges.csv' }))).items;
		expect(row).toMatchObject({ status: 'needs_confirmation', confirmation: { reason: 'typed_name', expected: 'Kanyakwar' }, request: { sourceId: 'kanyakwar', destinationId: 'kogony' } });
		expect(await confirmMany(staged, [row.id])).toEqual({ confirmed: [], skipped: [row.id] });
		expect(await confirmItem(staged, row.id, { revision: row.revision, confirmName: 'Kanyakwar' })).toMatchObject({ status: 'ready', request: { confirmName: 'Kanyakwar' } });
	});
});
