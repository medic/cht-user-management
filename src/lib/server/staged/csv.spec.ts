import { beforeEach, describe, expect, it } from 'vitest';

import type { Session } from '../auth/session';
import { getContactType } from '../config';
import { ApiError } from '../errors';
import type { OperationContext } from '../places/context';
import { searchPlaces } from '../places/directory';
import { clearPlaceCache } from '../places/lookup';
import { FakeCht } from '../testing/fake-cht';
import { createPlace } from '../places/create';
import type { UploadLog } from '../upload-log';
import { createColumns, stageCsv, templateCsv } from './csv';
import { listItems, listQuery, startUpload, type StagedDeps } from './service';
import { MemoryStagedStore } from './store';
import { MemoryUploadTracker } from './upload-tracker';

// Runs against Kenya's deployment (DEPLOYMENT_DIR in .env.test)
const CHU = 'c_community_health_unit';
const noLog: UploadLog = { log: async () => undefined, list: async () => [] };
const admin: Session = { instanceId: 'test', username: 'manager', facilityIds: ['*'], sessionCookie: 'AuthSession=abc', chtVersion: '4.18.0', isAdmin: true };

let cht: FakeCht;
let deps: StagedDeps;

function setup(session: Session = admin) {
	const context: OperationContext = { cht, session, uploadLog: noLog };
	deps = { store: new MemoryStagedStore(), tracker: new MemoryUploadTracker(), validationTracker: new MemoryUploadTracker(), context, maxBatch: 100 };
}

beforeEach(() => {
	clearPlaceCache();
	cht = new FakeCht().seed(
		{ _id: 'county-1', type: 'contact', contact_type: 'a_county', name: 'Kisumu' },
		{ _id: 'county-2', type: 'contact', contact_type: 'a_county', name: 'Siaya' },
		{ _id: 'sub-1', type: 'contact', contact_type: 'b_sub_county', name: 'Kisumu West', parent: { _id: 'county-1' } },
		{ _id: 'sub-2', type: 'contact', contact_type: 'b_sub_county', name: 'Central', parent: { _id: 'county-1' } },
		{ _id: 'sub-3', type: 'contact', contact_type: 'b_sub_county', name: 'Central', parent: { _id: 'county-2' } },
		{ _id: 'old-chu', type: 'contact', contact_type: CHU, name: 'Old Unit', code: '999999', parent: { _id: 'sub-1', parent: { _id: 'county-1' } } }
	);
	setup();
});

const HEADER = '"Sub County","CHU Name","CHU Code","Link Facility Name","Link Facility MFL Code","CHA Name","CHA Phone","Require password change"';
const row = (sub: string, name: string, code: string, phone = '0712345678') => `${sub},${name},${code},Kanyakwar Dispensary,12345,Jane ${name},${phone},`;

async function stageAndValidate(lines: string[]) {
	const result = await stageCsv(deps, { fileName: 'units.csv', text: [HEADER, ...lines].join('\n'), contactType: CHU });
	for (let i = 0; i < 200 && (await deps.validationTracker.state({ instanceId: 'test', username: 'manager' })).state === 'running'; i++) {
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	const { items } = await listItems(deps, listQuery.parse({ limit: '100' }));
	return { result, items };
}

describe('CSV template', () => {
	it('lists the hierarchy top first, then the place and person, without generated properties', () => {
		expect(templateCsv(getContactType(CHU)).trim()).toBe(HEADER);
		expect(createColumns(getContactType(CHU)).filter((c) => c.required).map((c) => c.header)).toEqual([
			'Sub County',
			'CHU Name',
			'CHU Code',
			'Link Facility Name',
			'Link Facility MFL Code',
			'CHA Name',
			'CHA Phone'
		]);
	});
});

describe('stageCsv', () => {
	it('refuses a file missing required columns, staging nothing', async () => {
		const error = await stageCsv(deps, { fileName: 'x.csv', text: '"Sub County","CHU Name"\nKisumu West,A', contactType: CHU }).then(
			() => undefined,
			(e) => e
		);
		expect(error).toBeInstanceOf(ApiError);
		expect(error.code).toBe('MISSING_COLUMNS');
		expect(error.details.columns).toContain('CHU Code');
		expect(await deps.store.list({ instanceId: 'test', username: 'manager' })).toHaveLength(0);
	});

	it('stages every row, then resolves names and checks each one in the background', async () => {
		const { result, items } = await stageAndValidate([
			row('Kisumu West', 'Kanyakwar', '100001'),
			row('', 'No Sub County', '100002'),
			row('Nowhere', 'Lost', '100003'),
			row('Central', 'Ambiguous', '100004'),
			row('kisumu  west', 'Bad Phone', '100005', '123'),
			row('Kisumu West', 'Twin A', '200000'),
			row('Kisumu West', 'Twin B', '200000'),
			row('Kisumu West', 'Copy Of Old', '999999')
		]);

		expect(result).toEqual({ staged: 8, invalid: 2 });
		const byTitle = Object.fromEntries(items.map((item) => [item.summary.title, item]));

		expect(byTitle['Kanyakwar']).toMatchObject({
			status: 'ready',
			request: { parentId: 'sub-1' },
			summary: { subtitle: 'Kisumu › Kisumu West' },
			source: { type: 'csv', file: 'units.csv', row: 2 }
		});
		expect(byTitle['No Sub County']).toMatchObject({ status: 'invalid', errors: { 'hierarchy.SUBCOUNTY': 'Is Required' } });
		expect(byTitle['Lost'].errors?.['hierarchy.SUBCOUNTY']).toMatch(/Can't find Sub County "Nowhere"/);
		expect(byTitle['Ambiguous'].errors?.['hierarchy.SUBCOUNTY']).toMatch(/Found 2 places called "Central"/);
		// its place is still looked up, so fixing it only means fixing the phone
		expect(byTitle['Bad Phone']).toMatchObject({
			status: 'invalid',
			errors: { 'contact.phone': 'Not a valid KE phone number' },
			request: { parentId: 'sub-1' },
			checkedWithCht: true
		});
		expect(Object.keys(byTitle['Bad Phone'].errors ?? {})).toEqual(['contact.phone']);
		expect(byTitle['Twin A']).toMatchObject({ status: 'needs_confirmation', confirmation: { reason: 'duplicates' } });
		expect(byTitle['Twin B'].status).toBe('needs_confirmation');
		expect(byTitle['Copy Of Old'].confirmation).toMatchObject({ warnings: [{ placeIds: ['old-chu'] }] });
	});

	it('refuses parents outside the facilities of the person importing', async () => {
		setup({ ...admin, facilityIds: ['county-2'], isAdmin: false });

		const { items } = await stageAndValidate([row('Kisumu West', 'Elsewhere', '100001')]);

		expect(items[0].errors?.['hierarchy.SUBCOUNTY']).toMatch(/outside the places you manage/);
	});

	it('reads files with a byte-order mark, and roles-free types need no Roles column', async () => {
		const { items } = await stageAndValidate(['﻿' + row('Kisumu West', 'With Bom', '100009')].map((l) => l));
		expect(items[0].status).toBe('ready');
	});
});

describe('one person, many places from a CSV', () => {
	const personRow = (name: string, code: string, person: string, phone: string) =>
		`Kisumu West,${name},${code},Kanyakwar Dispensary,12345,${person},${phone},`;

	it('makes rows with the same-looking person one person, created by the first of them', async () => {
		const { result, items } = await stageAndValidate([
			personRow('Unit A', '300001', 'Jane Doe', '0712345678'),
			personRow('Unit B', '300002', '  jane   DOE ', '+254712345678'),
			personRow('Unit C', '300003', 'Jane Doe', '0712 345 678'),
			// same name, another phone: someone else
			personRow('Unit D', '300004', 'Jane Doe', '0799999999'),
			// a person with errors is never matched, so it can be fixed on its own
			personRow('Unit E', '300005', 'Jane Doe', '123')
		]);

		expect(result).toMatchObject({ staged: 5, invalid: 1, sharedPeople: 1 });
		const [a, b, c, d, e] = items;
		expect(a.request.contact.properties).toBeDefined();
		for (const later of [b, c]) {
			expect(later).toMatchObject({ status: 'ready', dependsOn: a.id, request: { contact: { id: a.request.contact.id } }, summary: { person: 'Jane Doe' } });
			expect(later.request.contact.properties).toBeUndefined();
		}
		expect(d.request.contact.id).not.toBe(a.request.contact.id);
		expect(d.dependsOn).toBeUndefined();
		expect(e).toMatchObject({ status: 'invalid' });
		expect(e.dependsOn).toBeUndefined();
	});

	it('matches rows to people already in the staged list, from a form or an earlier file', async () => {
		const earlier = await stageAndValidate([personRow('Unit A', '300001', 'Jane Doe', '0712345678')]);
		const personItem = earlier.items[0];

		const second = await stageCsv(deps, { fileName: 'more.csv', text: [HEADER, personRow('Unit B', '300002', 'JANE DOE', '0712 345 678')].join('\n'), contactType: CHU });
		expect(second).toMatchObject({ sharedPeople: 1 });
		const { items } = await listItems(deps, listQuery.parse({ file: 'more.csv' }));
		expect(items[0]).toMatchObject({ dependsOn: personItem.id, request: { contact: { id: personItem.request.contact.id } } });
	});

	it('uploads the rows as one login with every place', async () => {
		await stageAndValidate([personRow('Unit A', '300001', 'Jane Doe', '0712345678'), personRow('Unit B', '300002', 'jane doe', '0712345678')]);

		await startUpload(deps);
		for (let i = 0; i < 1000 && (await deps.tracker.state({ instanceId: 'test', username: 'manager' })).state === 'running'; i++) {
			await new Promise((resolve) => setTimeout(resolve, 5));
		}

		const { items } = await listItems(deps, listQuery.parse({ limit: '100' }));
		expect(items.map((i) => i.status)).toEqual(['created', 'created']);
		const user = [...cht.users.values()].find((u) => u.username === 'jane_doe');
		expect(user?.place).toHaveLength(2);
	});
});

describe('replacing from a CSV', () => {
	const HEADER_R = '"Sub County","Affected CHU","Username","Scope","CHA Name","CHA Phone","Require password change","CHU Name","CHU Code","Link Facility Name","Link Facility MFL Code"';
	const unit = (name: string, code: string) => ({ name, code, link_facility_name: 'Kanyakwar Dispensary', link_facility_code: '12345' });

	// Jane serves Kanyakwar and Kogony; Paul serves Nyalenda
	beforeEach(async () => {
		const context = deps.context;
		await createPlace(context, 'kanyakwar', { contactType: CHU, parentId: 'sub-1', place: unit('Kanyakwar', '300001'), contact: { id: 'jane', properties: { name: 'jane doe', phone: '0712345678' } }, ignoreWarnings: false });
		await createPlace(context, 'kogony', { contactType: CHU, parentId: 'sub-1', place: unit('Kogony', '300002'), contact: { id: 'jane' }, ignoreWarnings: false });
		await createPlace(context, 'nyalenda', { contactType: CHU, parentId: 'sub-1', place: unit('Nyalenda', '300003'), contact: { id: 'paul', properties: { name: 'paul oduor', phone: '0755000000' } }, ignoreWarnings: false });
		// what CHT keeps for each account, read by Username
		cht.seed({ _id: 'org.couchdb.user:paul_oduor', type: 'user-settings', name: 'paul_oduor', contact_id: 'paul' });
	});

	async function stageReplaceCsv(lines: string[]) {
		const result = await stageCsv(deps, { fileName: 'handover.csv', text: [HEADER_R, ...lines].join('\n'), contactType: CHU, kind: 'replace' });
		for (let i = 0; i < 400 && (await deps.validationTracker.state({ instanceId: 'test', username: 'manager' })).state === 'running'; i++) {
			await new Promise((resolve) => setTimeout(resolve, 5));
		}
		const { items } = await listItems(deps, listQuery.parse({ file: 'handover.csv', limit: '100' }));
		return { result, items };
	}

	it('has a template with the place being replaced, Username and Scope, the person, then the optional place fields', () => {
		expect(templateCsv(getContactType(CHU), 'replace').trim()).toBe(HEADER_R);
	});

	it('finds each place by name and each Username’s person, then checks each row like the form', async () => {
		const { result, items } = await stageReplaceCsv([
			'Kisumu West,Kanyakwar,,,grace owino,0744000000,,,,,',
			'Kisumu West,Nyalenda,,place,,,,,,,',
			'kisumu west,nyalenda community health unit,paul_oduor,place,,,,,,,',
			'Kisumu West,Nowhere,,,amos kip,0766000000,,,,,',
			'Kisumu West,Kogony,nobody,,,,,,,,',
			'Kisumu West,Kogony,paul_oduor,sometimes,amos kip,0766000000,,,,,'
		]);

		expect(result).toMatchObject({ staged: 6 });
		const [grace, noPerson, paulSelf, nowhere, nobody, both] = items;
		expect(grace).toMatchObject({
			status: 'ready',
			request: { placeId: 'kanyakwar', contact: { properties: { name: 'grace owino' } } },
			claims: ['kanyakwar', 'kogony'],
			summary: { title: 'Kanyakwar Community Health Unit and 1 more', person: 'Jane Doe → Grace Owino' }
		});
		expect(noPerson).toMatchObject({ status: 'invalid' });
		expect(Object.keys(noPerson.errors ?? {})).toEqual(expect.arrayContaining(['contact.name', 'contact.phone']));
		// Paul already holds Nyalenda
		expect(paulSelf).toMatchObject({ status: 'invalid', request: { placeId: 'nyalenda', contact: { id: 'paul' } } });
		expect(paulSelf.errors?.replacement).toMatch(/already has/);
		expect(nowhere.errors?.replacement).toMatch(/Can't find Community Health Unit "Nowhere"/);
		expect(nobody.errors?.['contact.id']).toMatch(/No account called "nobody"/);
		expect(both.errors).toMatchObject({ 'contact.id': expect.stringMatching(/either Username/), scope: expect.any(String) });
	});

	it('flags a row handing over a place another row, or a waiting item, already hands over', async () => {
		const { items } = await stageReplaceCsv([
			'Kisumu West,Kanyakwar,,,grace owino,0744000000,,,,,',
			// Kogony goes with Kanyakwar, as scope is all
			'Kisumu West,Kogony,paul_oduor,place,,,,,,,'
		]);

		expect(items.map((i) => i.status)).toEqual(['ready', 'invalid']);
		expect(items[1].errors?.replacement).toMatch(/another item in your staged list also hands over/);
	});

	it('uploads the rows it finds ready', async () => {
		await stageReplaceCsv(['Kisumu West,Kogony,paul_oduor,place,,,,,,,']);

		await startUpload(deps);
		for (let i = 0; i < 400 && (await deps.tracker.state({ instanceId: 'test', username: 'manager' })).state === 'running'; i++) {
			await new Promise((resolve) => setTimeout(resolve, 5));
		}

		expect((await listItems(deps, listQuery.parse({}))).counts).toEqual({ created: 1 });
		expect(cht.users.get('paul_oduor')?.place.sort()).toEqual(['kogony', 'nyalenda']);
		expect(cht.users.get('jane_doe')?.place).toEqual(['kanyakwar']);
	});
});

describe('searchPlaces', () => {
	it('ranks exact and prefix matches first, and filters by parent', async () => {
		const results = await searchPlaces(cht, admin, { type: 'b_sub_county', q: 'cent', limit: 20 });
		expect(results.map((r) => r.id).sort()).toEqual(['sub-2', 'sub-3']);
		expect(results[0].lineage[0].name).toMatch(/Kisumu|Siaya/);

		const underSiaya = await searchPlaces(cht, admin, { type: 'b_sub_county', q: 'central', parentId: 'county-2', limit: 20 });
		expect(underSiaya.map((r) => r.id)).toEqual(['sub-3']);
	});

	it('only returns places within the caller’s facilities', async () => {
		const results = await searchPlaces(cht, { ...admin, facilityIds: ['county-2'], isAdmin: false }, { type: 'b_sub_county', q: '', limit: 20 });
		expect(results.map((r) => r.id)).toEqual(['sub-3']);
	});
});
