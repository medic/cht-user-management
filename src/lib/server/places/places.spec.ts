import { beforeEach, describe, expect, it } from 'vitest';

import type { Session } from '../auth/session';
import { ApiError, ChtError } from '../errors';
import { FakeCht } from '../testing/fake-cht';
import { MemoryUploadLog } from '../upload-log';
import { credentialsFor } from './credentials';
import type { OperationContext } from './context';
import { runBatch } from './batch';
import { createPlace } from './create';
import { conflictBackoff } from './documents';
import { replacePrimaryContact } from './replace';
import { createRequest, replaceRequest, type CreateRequest, type ReplaceRequest } from './schemas';
import { clearPlaceCache } from './lookup';

// Runs against Kenya's deployment (DEPLOYMENT_DIR in .env.test)
const CHU = 'c_community_health_unit';
const CHV_AREA = 'd_community_health_volunteer_area';

const admin: Session = {
	instanceId: 'test',
	username: 'manager',
	facilityIds: ['*'],
	sessionCookie: 'AuthSession=abc',
	chtVersion: '4.18.0',
	isAdmin: true
};

let cht: FakeCht;
let uploadLog: MemoryUploadLog;
let context: OperationContext;

beforeEach(() => {
	clearPlaceCache();
	uploadLog = new MemoryUploadLog();
	cht = new FakeCht().seed(
		{ _id: 'county-1', type: 'contact', contact_type: 'a_county', name: 'Kisumu' },
		{ _id: 'sub-1', type: 'contact', contact_type: 'b_sub_county', name: 'Kisumu West', parent: { _id: 'county-1' } },
		{ _id: 'sub-2', type: 'contact', contact_type: 'b_sub_county', name: 'Seme', parent: { _id: 'county-1' } }
	);
	context = { cht, session: admin, uploadLog };
});

const chuRequest = (overrides: Partial<CreateRequest> = {}): CreateRequest =>
	createRequest.parse({
		contactType: CHU,
		parentId: 'sub-1',
		place: { name: 'Kanyakwar', code: '123456', link_facility_name: 'Kanyakwar Dispensary', link_facility_code: '12345' },
		contact: { id: 'contact-1', properties: { name: 'jane doe', phone: '0712345678' } },
		...overrides
	});

const replaceChu = (contactId: string, name: string, overrides: Partial<ReplaceRequest> = {}): ReplaceRequest =>
	replaceRequest.parse({
		contactType: CHU,
		contact: { id: contactId, properties: { name, phone: '0722000000' } },
		...overrides
	});

async function expectApiError(promise: Promise<unknown>, status: number, code: string): Promise<ApiError> {
	const error = await promise.then(
		() => undefined,
		(e) => e
	);
	expect(error).toBeInstanceOf(ApiError);
	expect({ status: error.status, code: error.code }).toEqual({ status, code });
	return error;
}

describe('createPlace', () => {
	it('writes the place, contact and user, applying the deployment mutation', async () => {
		const result = await createPlace(context, 'place-1', chuRequest());

		expect(result.status).toBe(201);
		expect(result.body).toMatchObject({ outcome: 'created', placeId: 'place-1', contactId: 'contact-1', username: 'jane_doe' });
		expect(result.body.password).toHaveLength(9);

		expect(cht.docs.get('place-1')).toMatchObject({
			type: 'contact',
			contact_type: CHU,
			name: 'Kanyakwar Community Health Unit',
			code: '123456',
			parent: { _id: 'sub-1', parent: { _id: 'county-1' } },
			contact: { _id: 'contact-1', parent: { _id: 'place-1', parent: { _id: 'sub-1', parent: { _id: 'county-1' } } } }
		});
		expect(cht.docs.get('contact-1')).toMatchObject({ type: 'person', name: 'Jane Doe', phone: '+254712345678', parent: { _id: 'place-1' } });
		expect(cht.users.get('jane_doe')).toMatchObject({ contact: 'contact-1', place: ['place-1'], roles: ['community_health_assistant'] });
		expect(uploadLog.records[0].credentials).toMatchObject({ username: 'jane_doe', placeId: 'place-1', contactId: 'contact-1' });
	});

	it('replays a finished request without writing, returning the logged password', async () => {
		const first = await createPlace(context, 'place-1', chuRequest());
		const writesBefore = cht.calls.filter((call) => call === 'putDoc' || call === 'createUser').length;

		const replay = await createPlace(context, 'place-1', chuRequest());

		expect(replay.status).toBe(200);
		expect(replay.body).toEqual({ ...first.body, outcome: 'already_applied' });
		expect(cht.calls.filter((call) => call === 'putDoc' || call === 'createUser')).toHaveLength(writesBefore);
		expect(cht.users.size).toBe(1);
	});

	it('resumes after failing between writing the docs and creating the user', async () => {
		cht.failNext('createUser', new ChtError(400, 'something unexpected'));
		await expect(createPlace(context, 'place-1', chuRequest())).rejects.toBeInstanceOf(ChtError);
		expect(cht.docs.has('place-1')).toBe(true);
		expect(cht.users.size).toBe(0);

		const retry = await createPlace(context, 'place-1', chuRequest());

		expect(retry.status).toBe(201);
		expect(cht.users.get('jane_doe')?.place).toEqual(['place-1']);
	});

	it('does not create a second user when user creation times out after CHT accepted it', async () => {
		cht.failNext('createUser', new ChtError(503, 'gateway timeout'), { afterSuccess: true });

		const result = await createPlace(context, 'place-1', chuRequest());

		expect(result.body.username).toBe('jane_doe');
		expect(result.body.password).toBe(cht.users.get('jane_doe')?.password);
		expect(cht.users.size).toBe(1);
	});

	it('suffixes the username when it is taken by someone else', async () => {
		cht.seedUser({ username: 'jane_doe', place: ['elsewhere'], contact: 'someone-else', roles: [] });

		const result = await createPlace(context, 'place-1', chuRequest());

		expect(result.body.username).toMatch(/^jane_doe\d{1,2}$/);
	});

	it('rejects reusing a place id for a different place', async () => {
		await createPlace(context, 'place-1', chuRequest());
		await expectApiError(createPlace(context, 'place-1', chuRequest({ parentId: 'sub-2' })), 409, 'IDEMPOTENCY_CONFLICT');
	});

	it('reports every invalid property without writing anything', async () => {
		const error = await expectApiError(
			createPlace(context, 'place-1', chuRequest({ place: { name: 'Kanyakwar', code: '12', bogus: 'x' }, contact: { id: 'contact-1', properties: { name: 'Jane', phone: '123' } } })),
			422,
			'VALIDATION_FAILED'
		);

		expect(Object.keys(error.details ?? {}).sort()).toEqual([
			'contact.phone',
			'place.bogus',
			'place.code',
			'place.link_facility_code',
			'place.link_facility_name'
		]);
		expect(cht.docs.has('place-1')).toBe(false);
	});

	it('blocks on duplicate unique values until ignoreWarnings is set', async () => {
		cht.seed({ _id: 'old-chu', type: 'contact', contact_type: CHU, name: 'Other', code: '123456', parent: { _id: 'sub-2' } });

		const error = await expectApiError(createPlace(context, 'place-1', chuRequest()), 409, 'WARNINGS');
		expect(error.details?.warnings).toEqual([{ message: 'A place with the same "CHU Code" already exists', placeIds: ['old-chu'] }]);

		const result = await createPlace(context, 'place-1', chuRequest({ ignoreWarnings: true }));
		expect(result.status).toBe(201);
		expect(result.body.warnings).toHaveLength(1);
		// kept on the place in CHT as plain text, with the ids
		expect(cht.docs.get('place-1')?.user_attribution.warnings).toEqual(['A place with the same "CHU Code" already exists: old-chu']);
		// and read back the same way on a replay
		expect((await createPlace(context, 'place-1', chuRequest({ ignoreWarnings: true }))).body.warnings).toEqual([
			{ message: 'A place with the same "CHU Code" already exists: old-chu' }
		]);
	});

	it('attaches another place to an existing contact and its user', async () => {
		await createPlace(context, 'place-1', chuRequest());

		const second = await createPlace(
			context,
			'place-2',
			chuRequest({ place: { name: 'Kogony', code: '654321', link_facility_name: 'Kogony Dispensary', link_facility_code: '54321' }, contact: { id: 'contact-1' } })
		);

		expect(second.status).toBe(201);
		expect(second.body.username).toBe('jane_doe');
		expect(second.body.password).toBe(cht.users.get('jane_doe')?.password);
		expect(cht.users.get('jane_doe')?.place).toEqual(['place-1', 'place-2']);
		expect(cht.docs.get('place-2')?.contact).toEqual({ _id: 'contact-1', parent: { _id: 'place-1', parent: { _id: 'sub-1', parent: { _id: 'county-1' } } } });
	});

	describe('document update conflicts', () => {
		const conflict = () => new ChtError(409, 'Document update conflict', { error: 'conflict', reason: 'Document update conflict.' });
		const kogony = () =>
			chuRequest({ place: { name: 'Kogony', code: '654321', link_facility_name: 'Kogony Dispensary', link_facility_code: '54321' }, contact: { id: 'contact-1' } });

		beforeEach(() => {
			conflictBackoff.baseMs = 1;
		});

		it('retries creating the place, the person and the user', async () => {
			cht.failNext('putDoc', conflict()).failNext('createUser', conflict());
			// the person's write conflicts too, once the place is written
			cht.failNext('putDoc', new ChtError(500, 'Document update conflict'), { afterSuccess: false });

			const result = await createPlace(context, 'place-1', chuRequest());

			expect(result.status).toBe(201);
			expect(cht.docs.has('place-1') && cht.docs.has('contact-1')).toBe(true);
			expect(cht.users.get('jane_doe')?.place).toEqual(['place-1']);
		});

		it('takes a user created by the attempt that reported the conflict, rather than making a second', async () => {
			cht.failNext('createUser', conflict(), { afterSuccess: true });

			await createPlace(context, 'place-1', chuRequest());

			expect([...cht.users.keys()]).toEqual(['jane_doe']);
		});

		it('adds the place again from a fresh read, keeping a place another write added meanwhile', async () => {
			await createPlace(context, 'place-1', chuRequest());
			const updateUser = cht.updateUser.bind(cht);
			let raced = false;
			cht.updateUser = async (username, patch) => {
				if (!raced) {
					raced = true;
					// another upload adds its place to the same login, and ours conflicts
					cht.users.get(username)!.place.push('place-other');
					throw new ChtError(500, 'Document update conflict');
				}
				return updateUser(username, patch);
			};

			const second = await createPlace(context, 'place-2', kogony());

			expect(second.status).toBe(201);
			expect(cht.users.get('jane_doe')?.place).toEqual(['place-1', 'place-other', 'place-2']);
		});

		it('gives up after a few tries, with a request that can be sent again', async () => {
			await createPlace(context, 'place-1', chuRequest());
			for (let i = 0; i < 6; i++) cht.failNext('updateUser', conflict());

			const error = await expectApiError(createPlace(context, 'place-2', kogony()), 502, 'UPSTREAM_FAILED');
			expect(error.message).toMatch(/document update conflict/i);

			expect((await createPlace(context, 'place-2', kogony())).body.outcome).toBe('created');
			expect(cht.users.get('jane_doe')?.place).toEqual(['place-1', 'place-2']);
		});

		it('still refuses an id another request used for something else', async () => {
			cht.seed({ _id: 'place-1', type: 'contact', contact_type: 'a_county', name: 'Not a unit' });
			await expectApiError(createPlace(context, 'place-1', chuRequest()), 409, 'IDEMPOTENCY_CONFLICT');
		});
	});

	it('renders generated properties and copies CHU details for CHV areas', async () => {
		await createPlace(context, 'chu-1', chuRequest({ parentId: 'sub-1' }));

		const result = await createPlace(context, 'area-1', {
			contactType: CHV_AREA,
			parentId: 'chu-1',
			place: {},
			contact: { id: 'chv-1', properties: { name: 'mary atieno', phone: '0733000000' } },
			ignoreWarnings: false
		});

		expect(result.body.username).toBe('mary_atieno');
		expect(cht.docs.get('area-1')).toMatchObject({
			name: 'Mary Atieno Area',
			chu_code: '123456',
			chu_name: 'Kanyakwar Community Health Unit',
			link_facility_code: '12345'
		});
	});

	it('checks generated unique values, like CHP area names, against the ones already there', async () => {
		await createPlace(context, 'chu-1', chuRequest({ parentId: 'sub-1' }));
		const area = (id: string, name: string, phone: string) => ({
			contactType: CHV_AREA,
			parentId: 'chu-1',
			place: {},
			contact: { id: `chp-${id}`, properties: { name, phone } },
			ignoreWarnings: false
		});
		await createPlace(context, 'area-1', area('1', 'mary atieno', '0733000001'));

		// a second area in the same unit, compared with the first
		expect((await createPlace(context, 'area-2', area('2', 'grace owino', '0733000002'))).status).toBe(201);
		const same = await expectApiError(createPlace(context, 'area-3', area('3', 'MARY  atieno', '0733000003')), 409, 'WARNINGS');
		expect(same.details?.warnings).toEqual([expect.objectContaining({ placeIds: ['area-1'] })]);
	});

	it('refuses to give a new place a person from outside the caller\'s facilities', async () => {
		// jane, and her login, belong to a unit in Kisumu West
		await createPlace(context, 'place-1', chuRequest());
		const seme = { ...context, session: { ...admin, facilityIds: ['sub-2'] } };
		const kogony = chuRequest({ parentId: 'sub-2', place: { name: 'Kogony', code: '654321', link_facility_name: 'Kogony Dispensary', link_facility_code: '54321' }, contact: { id: 'contact-1' } });

		await expectApiError(createPlace(seme, 'place-2', kogony), 403, 'FORBIDDEN_PLACE');
		expect(cht.docs.has('place-2')).toBe(false);
		expect(cht.users.get('jane_doe')?.place).toEqual(['place-1']);
	});

	it('keeps each instance\'s generated passwords apart, even for the same username', async () => {
		await createPlace(context, 'place-1', chuRequest());
		expect(await credentialsFor(uploadLog, admin, ['place-1'])).toMatchObject([{ username: 'jane_doe', password: expect.any(String) }]);
		expect(await credentialsFor(uploadLog, { ...admin, instanceId: 'other' }, ['place-1'])).toEqual([]);
	});

	it('refuses places outside the caller\'s facilities', async () => {
		const outsider = { ...context, session: { ...admin, facilityIds: ['sub-2'] } };
		await expectApiError(createPlace(outsider, 'place-1', chuRequest()), 403, 'FORBIDDEN_PLACE');
	});

	it('reports a missing or wrong-type parent', async () => {
		await expectApiError(createPlace(context, 'place-1', chuRequest({ parentId: 'nope' })), 404, 'PARENT_NOT_FOUND');
		await expectApiError(createPlace(context, 'place-1', chuRequest({ parentId: 'county-1' })), 422, 'PARENT_WRONG_TYPE');
	});
});

describe('replacePrimaryContact', () => {
	const kogony = { name: 'Kogony', code: '654321', link_facility_name: 'Kogony Dispensary', link_facility_code: '54321' };
	const kisian = { name: 'Kisian', code: '777777', link_facility_name: 'Kisian Dispensary', link_facility_code: '77777' };
	// someone already here: Paul, with his own unit and account
	const paulTakesOver = (overrides: Partial<ReplaceRequest> = {}) => replaceRequest.parse({ contactType: CHU, contact: { id: 'cha-paul' }, ...overrides });

	beforeEach(async () => {
		await createPlace(context, 'place-1', chuRequest());
	});

	async function janeServesThree() {
		await createPlace(context, 'place-2', chuRequest({ place: kogony, contact: { id: 'contact-1' } }));
		await createPlace(context, 'place-3', chuRequest({ place: kisian, contact: { id: 'contact-1' } }));
	}

	async function paulHasAUnit() {
		const unit = { name: 'Nyalenda', code: '888888', link_facility_name: 'Nyalenda Dispensary', link_facility_code: '88888' };
		await createPlace(context, 'paul-unit', chuRequest({ place: unit, contact: { id: 'cha-paul', properties: { name: 'paul oduor', phone: '0755000000' } } }));
	}

	describe('a new person', () => {
		it('takes over: the place switches, the new login comes first, then the outgoing account is retired; the person stays', async () => {
			const result = await replacePrimaryContact(context, 'place-1', replaceChu('contact-2', 'john roe'));

			expect(result.status).toBe(201);
			expect(result.body).toMatchObject({
				outcome: 'replaced',
				contactId: 'contact-2',
				previousContactId: 'contact-1',
				affectedPlaceIds: ['place-1'],
				retiredUsers: ['jane_doe'],
				username: 'john_roe',
				places: ['place-1'],
				password: cht.users.get('john_roe')?.password
			});
			const place = cht.docs.get('place-1')!;
			expect(place.contact).toEqual({ _id: 'contact-2', parent: { _id: 'place-1', parent: { _id: 'sub-1', parent: { _id: 'county-1' } } } });
			expect(place.user_attribution).toMatchObject({
				// the creation record is kept, and the handover added to it
				created_time: expect.any(Number),
				previousPrimaryContacts: ['contact-1'],
				replacements: [{ contact: 'contact-2', previous_contact: 'contact-1', scope: 'all', affected_places: [], outgoing_users: ['jane_doe'] }]
			});
			expect(cht.docs.get('contact-2')?.parent?._id).toBe('place-1');
			// never deleted: Jane stays under her place, with her reports and history
			expect(cht.docs.get('contact-1')?.parent?._id).toBe('place-1');
			expect(cht.users.get('jane_doe')?.inactive).toBe(true);
			expect(cht.users.get('john_roe')).toMatchObject({ contact: 'contact-2', place: ['place-1'] });
			expect(cht.calls.lastIndexOf('createUser')).toBeLessThan(cht.calls.lastIndexOf('disableUser'));
		});

		it('replays a finished replacement, with the same response', async () => {
			const first = await replacePrimaryContact(context, 'place-1', replaceChu('contact-2', 'john roe'));
			const replay = await replacePrimaryContact(context, 'place-1', replaceChu('contact-2', 'john roe'));

			expect(replay.status).toBe(200);
			expect(replay.body).toEqual({ ...first.body, outcome: 'already_applied' });
			expect(cht.users.size).toBe(2);
		});

		it('leaves the outgoing login working when the new one fails, and finishes on a retry', async () => {
			cht.failNext('createUser', new ChtError(400, 'something unexpected'));
			await expect(replacePrimaryContact(context, 'place-1', replaceChu('contact-2', 'john roe'))).rejects.toBeInstanceOf(ChtError);
			expect(cht.docs.get('place-1')?.contact._id).toBe('contact-2');
			expect(cht.users.get('jane_doe')?.inactive).toBeUndefined();

			const retry = await replacePrimaryContact(context, 'place-1', replaceChu('contact-2', 'john roe'));

			expect(retry.status).toBe(201);
			expect(retry.body.retiredUsers).toEqual(['jane_doe']);
			expect(cht.users.get('john_roe')?.inactive).toBeUndefined();
			expect(cht.users.get('jane_doe')?.inactive).toBe(true);
		});

		it('takes over all the outgoing person’s places by default', async () => {
			await janeServesThree();

			const result = await replacePrimaryContact(context, 'place-1', replaceChu('contact-2', 'john roe'));

			expect(result.body.affectedPlaceIds).toEqual(['place-1', 'place-2', 'place-3']);
			expect(['place-2', 'place-3'].map((id) => cht.docs.get(id)?.contact._id)).toEqual(['contact-2', 'contact-2']);
			expect(cht.docs.get('place-2')?.user_attribution.previousPrimaryContacts).toEqual(['contact-1']);
			expect(cht.users.get('john_roe')?.place).toEqual(['place-1', 'place-2', 'place-3']);
			expect(cht.users.get('jane_doe')?.inactive).toBe(true);
			// never deleted: Jane stays under her place, with her reports and history
			expect(cht.docs.get('contact-1')?.parent?._id).toBe('place-1');
		});

		it('takes over just this place, leaving the outgoing person the rest', async () => {
			await janeServesThree();

			const result = await replacePrimaryContact(context, 'place-1', replaceChu('contact-2', 'john roe', { scope: 'place' }));

			expect(result.body).toMatchObject({ affectedPlaceIds: ['place-1'], retiredUsers: [], places: ['place-1'] });
			expect(cht.docs.get('place-2')?.contact._id).toBe('contact-1');
			expect(cht.users.get('jane_doe')).toMatchObject({ place: ['place-2', 'place-3'] });
			expect(cht.users.get('jane_doe')?.inactive).toBeUndefined();
			expect(cht.docs.has('contact-1')).toBe(true);
		});

		it('leaves alone another place someone has changed since, and the accounts of other people', async () => {
			await janeServesThree();
			cht.docs.get('place-3')!.contact = { _id: 'someone-else' };
			cht.seedUser({ username: 'supervisor', place: ['place-1'], contact: 'sup-1', roles: ['chu_supervisor'] });

			const result = await replacePrimaryContact(context, 'place-1', replaceChu('contact-2', 'john roe'));

			expect(result.body.affectedPlaceIds).toEqual(['place-1', 'place-2']);
			expect(cht.docs.get('place-3')?.contact._id).toBe('someone-else');
			// Jane still has place-3, so she keeps her login and her record
			expect(cht.users.get('jane_doe')).toMatchObject({ place: ['place-3'] });
			expect(cht.docs.has('contact-1')).toBe(true);
			expect(cht.users.get('supervisor')).toMatchObject({ place: ['place-1'] });
			expect(cht.users.get('supervisor')?.inactive).toBeUndefined();
		});

		it('recomputes generated place properties for the incoming person', async () => {
			await createPlace(context, 'chu-1', chuRequest({ place: kogony, contact: { id: 'cha-2', properties: { name: 'paul oduor', phone: '0755000000' } } }));
			await createPlace(context, 'area-1', {
				contactType: CHV_AREA,
				parentId: 'chu-1',
				place: {},
				contact: { id: 'chv-1', properties: { name: 'mary atieno', phone: '0733000000' } },
				ignoreWarnings: false
			});

			await replacePrimaryContact(context, 'area-1', replaceRequest.parse({ contactType: CHV_AREA, contact: { id: 'chv-2', properties: { name: 'grace owino', phone: '0744000000' } } }));

			expect(cht.docs.get('area-1')?.name).toBe('Grace Owino Area');
		});

		it('does not undo a later replacement when an older request is retried', async () => {
			await replacePrimaryContact(context, 'place-1', replaceChu('contact-2', 'john roe'));
			await replacePrimaryContact(context, 'place-1', replaceChu('contact-3', 'amos kip'));

			await expectApiError(replacePrimaryContact(context, 'place-1', replaceChu('contact-2', 'john roe')), 409, 'SUPERSEDED');
			expect(cht.docs.get('place-1')?.contact._id).toBe('contact-3');
		});

		it('refuses a person who is already primary, not through this tool', async () => {
			await expectApiError(replacePrimaryContact(context, 'place-1', replaceChu('contact-1', 'jane doe')), 409, 'ALREADY_PRIMARY');
		});

		it('refuses a new person id used for something else', async () => {
			await expectApiError(replacePrimaryContact(context, 'place-1', replaceChu('sub-2', 'john roe')), 409, 'IDEMPOTENCY_CONFLICT');
		});

		it('validates the new person, and only the place properties given', async () => {
			const error = await expectApiError(
				replacePrimaryContact(context, 'place-1', replaceChu('contact-2', 'john roe', { contact: { id: 'contact-2', properties: { name: 'john roe', phone: '12' } }, place: { code: 'x' } })),
				422,
				'VALIDATION_FAILED'
			);
			expect(Object.keys(error.details ?? {}).sort()).toEqual(['contact.phone', 'place.code']);
			expect(cht.docs.get('place-1')?.contact._id).toBe('contact-1');
		});
	});

	describe('an existing person', () => {
		beforeEach(paulHasAUnit);

		it('takes over with their own login, which gains the places', async () => {
			await janeServesThree();

			const result = await replacePrimaryContact(context, 'place-1', paulTakesOver());

			expect(result.body).toMatchObject({
				outcome: 'replaced',
				contactId: 'cha-paul',
				username: 'paul_oduor',
				affectedPlaceIds: ['place-1', 'place-2', 'place-3'],
				retiredUsers: ['jane_doe'],
				places: ['paul-unit', 'place-1', 'place-2', 'place-3']
			});
			expect(result.body).not.toHaveProperty('password');
			expect(cht.users.get('paul_oduor')?.place).toEqual(['paul-unit', 'place-1', 'place-2', 'place-3']);
			// Paul keeps his own lineage, under his first unit
			expect(cht.docs.get('place-1')?.contact).toEqual({ _id: 'cha-paul', parent: cht.docs.get('cha-paul')?.parent });
			expect(cht.users.get('jane_doe')?.inactive).toBe(true);
			// never deleted: Jane stays under her place, with her reports and history
			expect(cht.docs.get('contact-1')?.parent?._id).toBe('place-1');
		});

		it('takes over one neighbouring place', async () => {
			await janeServesThree();

			const result = await replacePrimaryContact(context, 'place-2', paulTakesOver({ scope: 'place' }));

			expect(result.body).toMatchObject({ affectedPlaceIds: ['place-2'], retiredUsers: [], places: ['paul-unit', 'place-2'] });
			expect(cht.users.get('jane_doe')?.place).toEqual(['place-1', 'place-3']);
		});

		it('has nothing to do when they already hold the place as its primary contact', async () => {
			await replacePrimaryContact(context, 'place-1', paulTakesOver());
			cht.docs.get('place-1')!.user_attribution.replacements = [];

			const again = await replacePrimaryContact(context, 'place-1', paulTakesOver());

			expect(again).toMatchObject({ status: 200, body: { outcome: 'already_applied', username: 'paul_oduor' } });
		});

		it('must have exactly one active account holding one of the type’s roles', async () => {
			cht.users.get('paul_oduor')!.roles = ['chu_supervisor'];
			const missingRole = await expectApiError(replacePrimaryContact(context, 'place-1', paulTakesOver()), 422, 'PERSON_NOT_ELIGIBLE');
			expect(missingRole.details).toEqual({ reason: 'MISSING_ROLE' });

			cht.users.get('paul_oduor')!.roles = ['community_health_assistant'];
			cht.users.get('paul_oduor')!.inactive = true;
			expect((await expectApiError(replacePrimaryContact(context, 'place-1', paulTakesOver()), 422, 'PERSON_NOT_ELIGIBLE')).details).toEqual({ reason: 'NO_ACTIVE_ACCOUNT' });

			cht.users.delete('paul_oduor');
			expect((await expectApiError(replacePrimaryContact(context, 'place-1', paulTakesOver()), 422, 'PERSON_NOT_ELIGIBLE')).details).toEqual({ reason: 'NO_ACCOUNT' });
		});

		it('gets no roles, and only for types that can share a person', async () => {
			await expectApiError(
				replacePrimaryContact(context, 'place-1', paulTakesOver({ user: { roles: ['community_health_assistant'] } })),
				422,
				'VALIDATION_FAILED'
			);
			await createPlace(context, 'area-1', {
				contactType: CHV_AREA,
				parentId: 'place-1',
				place: {},
				contact: { id: 'chv-1', properties: { name: 'mary atieno', phone: '0733000000' } },
				ignoreWarnings: false
			});
			await expectApiError(
				replacePrimaryContact(context, 'area-1', replaceRequest.parse({ contactType: CHV_AREA, contact: { id: 'chv-1' } })),
				422,
				'EXISTING_PERSON_NOT_ALLOWED'
			);
		});
	});
});

describe('runBatch', () => {
	it('creates a parent before the items that depend on it', async () => {
		const { results } = await runBatch(
			context,
			{
				items: [
					{
						op: 'create',
						placeId: 'area-1',
						body: {
							contactType: CHV_AREA,
							parentId: 'chu-1',
							place: {},
							contact: { id: 'chv-1', properties: { name: 'mary atieno', phone: '0733000000' } },
							ignoreWarnings: false
						}
					},
					{ op: 'create', placeId: 'chu-1', body: chuRequest() }
				]
			},
			100
		);

		expect(results.map((result) => [result.placeId, result.status])).toEqual([
			['area-1', 201],
			['chu-1', 201]
		]);
	});

	it('warns about duplicates between items and fails their dependants', async () => {
		const duplicate = chuRequest({ contact: { id: 'contact-2', properties: { name: 'john roe', phone: '0722000000' } } });
		const { results } = await runBatch(
			context,
			{
				items: [
					{ op: 'create', placeId: 'chu-1', body: chuRequest() },
					{ op: 'create', placeId: 'chu-2', body: duplicate },
					{
						op: 'create',
						placeId: 'area-1',
						body: {
							contactType: CHV_AREA,
							parentId: 'chu-2',
							place: {},
							contact: { id: 'chv-1', properties: { name: 'mary atieno', phone: '0733000000' } },
							ignoreWarnings: false
						}
					}
				]
			},
			100
		);

		expect(results.map((result) => result.status)).toEqual([409, 409, 424]);
		expect(cht.docs.has('chu-1')).toBe(false);
	});

	it('runs replaces that update the same account one after another, so none of its places is lost', async () => {
		const unit = (name: string, code: string) => ({ name, code, link_facility_name: `${name} Dispensary`, link_facility_code: '12345' });
		await createPlace(context, 'paul-unit', chuRequest({ place: unit('Nyalenda', '888888'), contact: { id: 'cha-paul', properties: { name: 'paul oduor', phone: '0755000000' } } }));
		await createPlace(context, 'a', chuRequest({ place: unit('Aa', '100001'), contact: { id: 'cha-a', properties: { name: 'alice', phone: '0755000001' } } }));
		await createPlace(context, 'b', chuRequest({ place: unit('Bb', '100002'), contact: { id: 'cha-b', properties: { name: 'bob', phone: '0755000002' } } }));
		await createPlace(context, 'c', chuRequest({ place: unit('Cc', '100003'), contact: { id: 'cha-c', properties: { name: 'carol', phone: '0755000003' } } }));

		const paul = { contactType: CHU, contact: { id: 'cha-paul' } };
		const { results } = await runBatch(
			context,
			{
				items: ['a', 'b', 'c'].map((placeId) => ({ op: 'replace' as const, placeId, body: replaceRequest.parse(paul) }))
			},
			100
		);

		expect(results.map((r) => r.status)).toEqual([201, 201, 201]);
		expect(cht.users.get('paul_oduor')?.place.sort()).toEqual(['a', 'b', 'c', 'paul-unit']);
	});

	it('rejects batches over the size limit', async () => {
		await expectApiError(runBatch(context, { items: [{ op: 'create', placeId: 'chu-1', body: chuRequest() }] }, 0), 413, 'BATCH_TOO_LARGE');
	});
});
