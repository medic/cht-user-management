import { beforeEach, describe, expect, it } from 'vitest';

import type { Session } from '../auth/session';
import { ApiError, ChtError } from '../errors';
import type { OperationContext } from '../places/context';
import { clearPlaceCache } from '../places/lookup';
import { FakeCht } from '../testing/fake-cht';
import { MemoryUploadLog } from '../upload-log';
import {
  addItem,
  clearFinished,
  confirmItem,
  confirmMany,
  editItem,
  findSamePerson,
  listItems,
  listQuery,
  removeItem,
  startUpload,
  placesCreatedBy,
  uploadGroup,
  type StagedDeps
} from './service';
import { stageCsv } from './csv';
import { createPlace } from '../places/create';
import { previewReplace, searchPeople } from '../places/replace-lookups';
import { replaceRequest } from '../places/schemas';
import { MemoryStagedStore } from './store';
import type { StagedItem } from './types';
import { MemoryUploadTracker } from './upload-tracker';

// Runs against Kenya's deployment (DEPLOYMENT_DIR in .env.test)
const CHU = 'c_community_health_unit';

const session: Session = {
  instanceId: 'test',
  username: 'manager',
  facilityIds: ['*'],
  sessionCookie: 'AuthSession=abc',
  chtVersion: '4.18.0',
  isAdmin: true
};

let cht: FakeCht;
let deps: StagedDeps;

beforeEach(() => {
  clearPlaceCache();
  cht = new FakeCht().seed(
    { _id: 'county-1', type: 'contact', contact_type: 'a_county', name: 'Kisumu' },
    { _id: 'sub-1', type: 'contact', contact_type: 'b_sub_county', name: 'Kisumu West', parent: { _id: 'county-1' } }
  );
  const context: OperationContext = { cht, session, uploadLog: new MemoryUploadLog() };
  deps = {
    store: new MemoryStagedStore(),
    tracker: new MemoryUploadTracker(),
    validationTracker: new MemoryUploadTracker(),
    context,
    maxBatch: 100
  };
});

const chu = (n: number, overrides: Record<string, unknown> = {}) => ({
  kind: 'create' as const,
  request: {
    contactType: CHU,
    placeId: `place-${n}`,
    parentId: 'sub-1',
    place: { name: `Unit ${n}`, code: String(100000 + n), link_facility_name: 'Kanyakwar Dispensary', link_facility_code: '12345' },
    contact: { id: `contact-${n}`, properties: { name: `worker ${n}`, phone: `07123456${String(n).padStart(2, '0')}` } },
    ...overrides
  }
});

const list = (query: Record<string, string> = {}) => listItems(deps, listQuery.parse(query));

async function expectApiError(promise: Promise<unknown>, code: string): Promise<ApiError> {
  const error = await promise.then(
    () => undefined,
    (e) => e
  );
  expect(error).toBeInstanceOf(ApiError);
  expect(error.code).toBe(code);
  return error;
}

async function uploadAndWait(ids?: string[]) {
  const started = await startUpload(deps, ids);
  for (let i = 0; i < 1000 && (await deps.tracker.state({ instanceId: 'test', username: 'manager' })).state === 'running'; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return started;
}

describe('adding items', () => {
  it('checks the request like a create would, and stages it ready with a readable summary', async () => {
    const item = await addItem(deps, chu(1));

    expect(item).toMatchObject({
      kind: 'create',
      status: 'ready',
      revision: 1,
      source: { type: 'form' },
      summary: { title: 'Unit 1', subtitle: 'Kisumu › Kisumu West', person: 'Worker 1' }
    });
    expect(cht.docs.has('place-1')).toBe(false);
    expect((await list()).counts).toEqual({ ready: 1 });
  });

  it('refuses what the create itself would refuse, without staging it', async () => {
    await expectApiError(addItem(deps, chu(1, { parentId: 'nope' })), 'PARENT_NOT_FOUND');
    const invalid = await expectApiError(
      addItem(deps, chu(2, { place: { name: 'Unit 2', code: '12', link_facility_name: 'X', link_facility_code: '12345' } })),
      'VALIDATION_FAILED'
    );
    expect(invalid.details).toHaveProperty('place.code');
    expect((await list()).items).toHaveLength(0);
  });

  it('asks for duplicate warnings to be accepted first', async () => {
    cht.seed({ _id: 'old', type: 'contact', contact_type: CHU, name: 'Old', code: '100001', parent: { _id: 'sub-1' } });

    await expectApiError(addItem(deps, chu(1)), 'WARNINGS');
    const item = await addItem(deps, chu(1, { ignoreWarnings: true }));
    expect(item.status).toBe('ready');
  });

  it('refuses a place id that is already staged', async () => {
    await addItem(deps, chu(1));
    await expectApiError(
      addItem(deps, {
        ...chu(1),
        request: { ...chu(1).request, contact: { id: 'contact-9', properties: chu(1).request.contact.properties } }
      }),
      'IDEMPOTENCY_CONFLICT'
    );
  });

  it('refuses a request that isn’t the shape its kind needs', async () => {
    await expectApiError(addItem(deps, { kind: 'create', request: {} }), 'INVALID_REQUEST');
    await expectApiError(addItem(deps, { kind: 'merge', request: { sourceId: 'place-1' } }), 'INVALID_REQUEST');
  });

  it('refuses an action the type doesn’t allow, from the form or a CSV', async () => {
    // households can only be moved
    const household = { ...chu(1).request, contactType: 'e_household' };
    for (const kind of ['create', 'replace', 'merge', 'delete'] as const) {
      const refused = await expectApiError(addItem(deps, { kind, request: household }), 'ACTION_NOT_ALLOWED');
      expect(refused.details).toEqual({ action: kind });
    }
    await expectApiError(
      stageCsv(deps, { fileName: 'households.csv', text: 'Household\nA', contactType: 'e_household', kind: 'delete' }),
      'ACTION_NOT_ALLOWED'
    );
    expect((await list()).items).toHaveLength(0);
  });
});

describe('editing, confirming and removing', () => {
  it('re-checks an edit, keeps the ids, and rejects stale revisions', async () => {
    const item = await addItem(deps, chu(1));
    const edited = await editItem(deps, item.id, {
      revision: item.revision,
      request: { ...item.request, place: { ...item.request.place, name: 'Renamed' } }
    });
    expect(edited).toMatchObject({ revision: 2, summary: { title: 'Renamed' } });

    await expectApiError(editItem(deps, item.id, { revision: item.revision, request: edited.request }), 'REVISION_MISMATCH');
    await expectApiError(
      editItem(deps, item.id, { revision: edited.revision, request: { ...edited.request, placeId: 'other' } }),
      'IDS_FIXED'
    );
  });

  it('confirms duplicates by accepting the warnings, and typed names only when they match', async () => {
    const owner = { instanceId: 'test', username: 'manager' };
    const base = await addItem(deps, chu(1));
    const waiting = await deps.store.put(
      owner,
      { ...base, status: 'needs_confirmation', confirmation: { reason: 'duplicates', warnings: [{ message: 'dup' }] } },
      base.revision
    );

    const confirmed = await confirmItem(deps, waiting.id, { revision: waiting.revision });
    expect(confirmed).toMatchObject({ status: 'ready', request: { ignoreWarnings: true } });
    expect(confirmed.confirmation).toBeUndefined();

    const typed: StagedItem = { ...confirmed, status: 'needs_confirmation', confirmation: { reason: 'typed_name', expected: 'Unit 1' } };
    const saved = await deps.store.put(owner, typed, confirmed.revision);
    await expectApiError(confirmItem(deps, saved.id, { revision: saved.revision, confirmName: 'unit 1' }), 'CONFIRMATION_REQUIRED');
    expect((await confirmItem(deps, saved.id, { revision: saved.revision, confirmName: 'Unit 1' })).status).toBe('ready');
  });

  it('never bulk-confirms an item that needs its name typed', async () => {
    const owner = { instanceId: 'test', username: 'manager' };
    const a = await addItem(deps, chu(1));
    const b = await addItem(deps, chu(2));
    await deps.store.put(owner, { ...a, status: 'needs_confirmation', confirmation: { reason: 'duplicates', warnings: [] } }, a.revision);
    await deps.store.put(
      owner,
      { ...b, status: 'needs_confirmation', confirmation: { reason: 'typed_name', expected: 'Unit 2' } },
      b.revision
    );

    expect(await confirmMany(deps, [a.id, b.id])).toEqual({ confirmed: [a.id], skipped: [b.id] });
  });

  it('removes items, but not while they upload', async () => {
    const owner = { instanceId: 'test', username: 'manager' };
    const item = await addItem(deps, chu(1));
    const uploading = await deps.store.put(owner, { ...item, status: 'uploading' }, item.revision);
    await expectApiError(removeItem(deps, uploading.id), 'ITEM_LOCKED');

    await deps.store.put(owner, { ...uploading, status: 'ready' }, uploading.revision);
    await removeItem(deps, item.id);
    expect((await list()).items).toHaveLength(0);
  });
});

describe('uploading', () => {
  it('creates every ready item and records each result on its item', async () => {
    await addItem(deps, chu(1));
    await addItem(deps, chu(2));

    expect(await uploadAndWait()).toEqual({ uploading: 2 });

    const { items, counts, upload } = await list();
    expect(counts).toEqual({ created: 2 });
    expect(upload).toMatchObject({ state: 'idle', done: 2, total: 2 });
    // newest first
    expect(items.map((i) => i.result?.username)).toEqual(['worker_2', 'worker_1']);
    expect(cht.docs.has('place-1') && cht.docs.has('place-2')).toBe(true);
  });

  it('sends items that turn out to duplicate each other back for confirmation', async () => {
    await addItem(deps, chu(1));
    await addItem(deps, chu(2, { place: { ...chu(1).request.place, name: 'Unit 2' } }));

    await uploadAndWait();

    const { items } = await list();
    expect(items.map((i) => i.status)).toEqual(['needs_confirmation', 'needs_confirmation']);
    expect(items[0].confirmation).toMatchObject({ reason: 'duplicates' });
    expect(cht.docs.has('place-1')).toBe(false);
  });

  it('fails an item its type’s hook refuses, with the hook’s own message, writing nothing', async () => {
    // Kenya's CHP-area hook copies the unit's facility onto the area, and this unit has none
    cht.seed({
      _id: 'unit-1',
      type: 'contact',
      contact_type: CHU,
      name: 'Kanyakwar Community Health Unit',
      code: '100001',
      parent: { _id: 'sub-1', parent: { _id: 'county-1' } }
    });
    const item = await addItem(deps, {
      kind: 'create',
      request: {
        contactType: 'd_community_health_volunteer_area',
        placeId: 'area-1',
        parentId: 'unit-1',
        place: {},
        contact: { id: 'promoter-1', properties: { name: 'Mary Achieng', phone: '0712345601' } }
      }
    });
    expect(item.status).toBe('ready');

    await uploadAndWait();

    expect((await list()).items[0]).toMatchObject({
      status: 'failed',
      failure: {
        code: 'HOOK_FAILED',
        message: 'eCHIS-KE logic cant find existing data for link_facility_code',
        details: { hook: 'hooks/copy-unit-facility.mjs' }
      }
    });
    expect(cht.docs.has('area-1') || cht.docs.has('promoter-1')).toBe(false);
  });

  it('marks failures, and retries them when asked', async () => {
    const item = await addItem(deps, chu(1));
    cht.failNext('putDoc', new ChtError(503, 'unavailable'));

    await uploadAndWait();
    const failed = (await list()).items[0];
    expect(failed).toMatchObject({ status: 'failed', failure: { code: 'UPSTREAM_FAILED' } });

    await uploadAndWait([item.id]);
    expect((await list()).items[0].status).toBe('created');
  });

  it('marks items left uploading by a stopped server as failed and retryable', async () => {
    const owner = { instanceId: 'test', username: 'manager' };
    const item = await addItem(deps, chu(1));
    await deps.store.put(owner, { ...item, status: 'uploading' }, item.revision);

    const { items } = await list();
    expect(items[0]).toMatchObject({ status: 'failed', failure: { code: 'UPLOAD_INTERRUPTED' } });
  });

  it('clears finished items only', async () => {
    await addItem(deps, chu(1));
    await uploadAndWait();
    await addItem(deps, chu(2));

    expect(await clearFinished(deps)).toEqual({ removed: 1 });
    expect((await list()).items.map((i) => i.status)).toEqual(['ready']);
  });
});

describe('one person, many places', () => {
  const owner = { instanceId: 'test', username: 'manager' };
  // another place for the person item 1 creates: the same contact id, no properties
  const samePerson = (n: number, overrides: Record<string, unknown> = {}) => chu(n, { contact: { id: 'contact-1' }, ...overrides });

  it('stages later places for a staged person, checked with their details and showing their name', async () => {
    const first = await addItem(deps, chu(1));
    const second = await addItem(deps, samePerson(2));

    expect(second).toMatchObject({ status: 'ready', dependsOn: first.id, summary: { title: 'Unit 2', person: 'Worker 1' } });
    expect(second.request.contact).toEqual({ id: 'contact-1' });
  });

  it('refuses the person twice, and a person without details who is neither staged nor in CHT', async () => {
    await addItem(deps, chu(1));
    await expectApiError(
      addItem(deps, chu(2, { contact: { id: 'contact-1', properties: { name: 'Other', phone: '0712345699' } } })),
      'CONTACT_ALREADY_STAGED'
    );
    const missing = await expectApiError(addItem(deps, chu(3, { contact: { id: 'nobody' } })), 'VALIDATION_FAILED');
    expect(missing.details).toHaveProperty(['contact.properties']);
  });

  it('uploads the person first, then adds each later place to the same login, one after another', async () => {
    await addItem(deps, chu(1));
    await addItem(deps, samePerson(2));
    await addItem(deps, samePerson(3));

    await uploadAndWait();

    const { items, counts } = await list();
    expect(counts).toEqual({ created: 3 });
    expect(new Set(items.map((i) => i.result?.username))).toEqual(new Set(['worker_1']));
    expect(cht.users.get('worker_1')?.place.sort()).toEqual(['place-1', 'place-2', 'place-3']);
    // the person stays under the first place; the others point at them
    expect(cht.docs.get('contact-1')?.parent?._id).toBe('place-1');
    expect(cht.docs.get('place-2')?.contact).toEqual({
      _id: 'contact-1',
      parent: { _id: 'place-1', parent: { _id: 'sub-1', parent: { _id: 'county-1' } } }
    });
  });

  it('holds later places back when the person item fails or is not being uploaded', async () => {
    const first = await addItem(deps, chu(1));
    const second = await addItem(deps, samePerson(2));

    await uploadAndWait([second.id]);
    expect(await deps.store.get(owner, second.id)).toMatchObject({ status: 'ready', failure: { code: 'WAITING_FOR_PERSON' } });

    cht.failNext('putDoc', new ChtError(503, 'unavailable'));
    await uploadAndWait();
    expect(await deps.store.get(owner, first.id)).toMatchObject({ status: 'failed' });
    expect(await deps.store.get(owner, second.id)).toMatchObject({ status: 'ready', failure: { code: 'DEPENDENCY_FAILED' } });
    expect(cht.docs.has('place-2')).toBe(false);

    await uploadAndWait([first.id, second.id]);
    expect((await list()).counts).toEqual({ created: 2 });
  });

  it('hands the person over to their next place when the item creating them is removed', async () => {
    const first = await addItem(deps, chu(1));
    const second = await addItem(deps, samePerson(2));
    const third = await addItem(deps, samePerson(3));

    await removeItem(deps, first.id);

    const heir = await deps.store.get(owner, second.id);
    expect(heir?.request.contact).toEqual(first.request.contact);
    expect(heir?.dependsOn).toBeUndefined();
    expect((await deps.store.get(owner, third.id))?.dependsOn).toBe(second.id);

    await uploadAndWait();
    expect(cht.users.get('worker_1')?.place.sort()).toEqual(['place-2', 'place-3']);
    expect(cht.docs.get('contact-1')?.parent?._id).toBe('place-2');
  });

  it('asks whether a new person entered in the form is someone already staged', async () => {
    const first = await addItem(deps, chu(1));
    // the same person, written differently, under a new id
    const again = chu(2, { contact: { id: 'contact-2', properties: { name: '  WORKER  1', phone: '+254712345601' } } });

    expect(await findSamePerson(deps, { contactType: CHU, contact: again.request.contact as any })).toMatchObject({
      match: { itemId: first.id, contactId: 'contact-1', name: 'Worker 1', placeTitle: 'Unit 1' }
    });
    expect((await findSamePerson(deps, { contactType: CHU, contact: chu(3).request.contact })).match).toBeNull();

    const asked = await expectApiError(addItem(deps, again), 'SAME_PERSON_STAGED');
    expect(asked.details).toMatchObject({ itemId: first.id, contactId: 'contact-1' });
    // "someone else": added as its own person
    expect((await addItem(deps, { ...again, newPerson: true })).dependsOn).toBeUndefined();
  });

  it('updates the summaries of their other places when the person is edited', async () => {
    const first = await addItem(deps, chu(1));
    const second = await addItem(deps, samePerson(2));

    const noPerson = await expectApiError(
      editItem(deps, first.id, { revision: first.revision, request: { ...first.request, contact: { id: 'contact-1' } } }),
      'VALIDATION_FAILED'
    );
    expect(noPerson.details).toHaveProperty(['contact.properties']);

    await editItem(deps, first.id, {
      revision: first.revision,
      request: { ...first.request, contact: { id: 'contact-1', properties: { name: 'jane doe', phone: '0712345601' } } }
    });
    expect((await deps.store.get(owner, second.id))?.summary.person).toBe('Jane Doe');

    await removeItem(deps, second.id);
    await removeItem(deps, first.id);
    expect((await list()).items).toHaveLength(0);
  });

  it('adds a place for a person already in CHT without staging them again', async () => {
    await addItem(deps, chu(1));
    await uploadAndWait();
    await clearFinished(deps);

    const later = await addItem(deps, samePerson(2));
    expect(later.dependsOn).toBeUndefined();
    expect(later.summary.person).toBe('Worker 1');
    await uploadAndWait();
    expect(cht.users.get('worker_1')?.place.sort()).toEqual(['place-1', 'place-2']);
  });
});

describe('replace items', () => {
  const owner = { instanceId: 'test', username: 'manager' };
  const unit = (n: number) => ({
    name: `Unit ${n}`,
    code: String(100000 + n),
    link_facility_name: 'Kanyakwar Dispensary',
    link_facility_code: '12345'
  });
  const replace = (placeId: string, contact: Record<string, unknown>, overrides: Record<string, unknown> = {}) => ({
    kind: 'replace' as const,
    request: { contactType: CHU, placeId, contact, ...overrides }
  });
  const grace = { id: 'grace', properties: { name: 'grace owino', phone: '0744000000' } };

  // Jane serves units 1 and 2; Paul serves unit 3
  beforeEach(async () => {
    await createPlace(deps.context, 'place-1', {
      contactType: CHU,
      parentId: 'sub-1',
      place: unit(1),
      contact: { id: 'jane', properties: { name: 'jane doe', phone: '0712345678' } },
      ignoreWarnings: false
    });
    await createPlace(deps.context, 'place-2', {
      contactType: CHU,
      parentId: 'sub-1',
      place: unit(2),
      contact: { id: 'jane' },
      ignoreWarnings: false
    });
    await createPlace(deps.context, 'place-3', {
      contactType: CHU,
      parentId: 'sub-1',
      place: unit(3),
      contact: { id: 'paul', properties: { name: 'paul oduor', phone: '0755000000' } },
      ignoreWarnings: false
    });
  });

  it('stages a replace with who is handed over to whom, and what it hands over', async () => {
    const item = await addItem(deps, replace('place-1', grace));

    expect(item).toMatchObject({
      kind: 'replace',
      status: 'ready',
      claims: ['place-1', 'place-2'],
      summary: { title: 'Unit 1 Community Health Unit and 1 more', subtitle: 'Kisumu › Kisumu West', person: 'Jane Doe → Grace Owino' }
    });
    expect((await addItem(deps, replace('place-3', { id: 'jane' }, { scope: 'place' }))).summary.person).toBe('Paul Oduor → Jane Doe');
  });

  it('refuses a second handover of a place already waiting in the list', async () => {
    await addItem(deps, replace('place-1', grace));

    await expectApiError(
      addItem(deps, replace('place-1', { id: 'amos', properties: { name: 'amos kip', phone: '0766000000' } })),
      'HANDOVER_ALREADY_STAGED'
    );
    // place-2 goes with place-1 (scope all)
    await expectApiError(
      addItem(deps, replace('place-2', { id: 'amos', properties: { name: 'amos kip', phone: '0766000000' } }, { scope: 'place' })),
      'HANDOVER_ALREADY_STAGED'
    );
  });

  it('refuses what the replace would refuse, without staging it', async () => {
    await expectApiError(addItem(deps, replace('place-1', { id: 'nobody' })), 'PERSON_NOT_FOUND');
    await expectApiError(addItem(deps, replace('place-1', { id: 'jane' })), 'NOTHING_TO_CHANGE');
    await expectApiError(
      addItem(deps, replace('place-1', { id: 'jane', properties: { name: 'jane doe', phone: '0712345678' } })),
      'ALREADY_PRIMARY'
    );
    expect((await list()).items).toHaveLength(0);
  });

  it('uploads replaces, and those sharing an account one after another', async () => {
    // Paul takes over both of Jane's units, one item each
    await addItem(deps, replace('place-1', { id: 'paul' }, { scope: 'place' }));
    await addItem(deps, replace('place-2', { id: 'paul' }, { scope: 'place' }));

    await uploadAndWait();

    const { items, counts } = await list();
    expect(counts).toEqual({ created: 2 });
    expect(items.map((i) => i.result?.username)).toEqual(['paul_oduor', 'paul_oduor']);
    expect(cht.users.get('paul_oduor')?.place.sort()).toEqual(['place-1', 'place-2', 'place-3']);
    expect(cht.users.get('jane_doe')?.inactive).toBe(true);
  });

  it('lets the incoming person change until the item has been sent', async () => {
    const item = await addItem(deps, replace('place-1', grace));
    const edited = await editItem(deps, item.id, { revision: item.revision, request: { ...item.request, contact: { id: 'paul' } } });
    expect(edited.summary.person).toBe('Jane Doe → Paul Oduor');

    await deps.store.put(
      owner,
      { ...edited, status: 'failed', upload: { runId: 'r', startedAt: new Date().toISOString() } },
      edited.revision
    );
    const failed = (await deps.store.get(owner, item.id))!;
    await expectApiError(
      editItem(deps, item.id, { revision: failed.revision, request: { ...failed.request, contact: grace } }),
      'IDS_FIXED'
    );
  });
});

describe('replace lookups', () => {
  const unit = (n: number) => ({
    name: `Unit ${n}`,
    code: String(100000 + n),
    link_facility_name: 'Kanyakwar Dispensary',
    link_facility_code: '12345'
  });

  beforeEach(async () => {
    await createPlace(deps.context, 'place-1', {
      contactType: CHU,
      parentId: 'sub-1',
      place: unit(1),
      contact: { id: 'jane', properties: { name: 'jane doe', phone: '0712345678' } },
      ignoreWarnings: false
    });
    await createPlace(deps.context, 'place-2', {
      contactType: CHU,
      parentId: 'sub-1',
      place: unit(2),
      contact: { id: 'jane' },
      ignoreWarnings: false
    });
    await createPlace(deps.context, 'place-3', {
      contactType: CHU,
      parentId: 'sub-1',
      place: unit(3),
      contact: { id: 'paul', properties: { name: 'paul oduor', phone: '0755000000' } },
      ignoreWarnings: false
    });
  });

  it('finds people who could take over, saying why someone can’t', async () => {
    cht.users.get('paul_oduor')!.inactive = true;

    const people = await searchPeople(cht, session, { type: CHU, q: '', limit: 20 });

    expect(people.map((p) => [p.name, p.eligible, p.reason])).toEqual([
      ['Jane Doe', true, undefined],
      ['Paul Oduor', false, 'NO_ACTIVE_ACCOUNT']
    ]);
    expect(people[0].account).toMatchObject({
      username: 'jane_doe',
      places: [
        { id: 'place-1', name: 'Unit 1 Community Health Unit' },
        { id: 'place-2', name: 'Unit 2 Community Health Unit' }
      ]
    });
    expect((await searchPeople(cht, session, { type: CHU, q: 'pau', limit: 20 })).map((p) => p.id)).toEqual(['paul']);
  });

  it('previews a handover without doing it', async () => {
    const all = await previewReplace(
      deps.context,
      'place-1',
      replaceRequest.parse({ contactType: CHU, contact: { id: 'grace', properties: { name: 'grace owino', phone: '0744000000' } } })
    );
    expect(all).toMatchObject({
      outgoing: { contactId: 'jane', name: 'Jane Doe' },
      incoming: { kind: 'new', name: 'Grace Owino' },
      placesHandedOver: [
        { id: 'place-1', name: 'Unit 1 Community Health Unit' },
        { id: 'place-2', name: 'Unit 2 Community Health Unit' }
      ],
      placesKept: [],
      retiredAccounts: [{ username: 'jane_doe', action: 'disable' }],
      outgoingPerson: 'keep'
    });

    const one = await previewReplace(
      deps.context,
      'place-1',
      replaceRequest.parse({ contactType: CHU, contact: { id: 'paul' }, scope: 'place' })
    );
    expect(one).toMatchObject({
      incoming: { kind: 'existing', name: 'Paul Oduor', username: 'paul_oduor' },
      placesHandedOver: [{ id: 'place-1', name: 'Unit 1 Community Health Unit' }],
      placesKept: [{ id: 'place-2', name: 'Unit 2 Community Health Unit' }],
      retiredAccounts: [],
      keptAccounts: [{ username: 'jane_doe' }],
      outgoingPerson: 'keep'
    });
    expect(cht.docs.get('place-1')?.contact._id).toBe('jane');
  });
});

describe('listing', () => {
  it('filters by status and text, and pages through results', async () => {
    for (const n of [1, 2, 3]) {
      await addItem(deps, chu(n));
    }

    expect((await list({ q: 'unit 2' })).items.map((i) => i.summary.title)).toEqual(['Unit 2']);
    expect((await list({ status: 'created' })).items).toHaveLength(0);

    const first = await list({ limit: '2' });
    expect(first.items.map((i) => i.summary.title)).toEqual(['Unit 3', 'Unit 2']);
    expect(first.total).toBe(3);
    const second = await list({ limit: '2', cursor: first.nextCursor! });
    expect(second.items.map((i) => i.summary.title)).toEqual(['Unit 1']);
    expect(second.nextCursor).toBeUndefined();
  });

  it('lists what is not uploaded first, then each upload, the latest first', async () => {
    const one = await addItem(deps, chu(1));
    await uploadAndWait();
    await new Promise((resolve) => setTimeout(resolve, 2));
    await addItem(deps, chu(2));
    await addItem(deps, chu(3));
    await uploadAndWait();
    const failing = await addItem(deps, chu(4));
    cht.failNext('putDoc', new ChtError(400, 'rejected'));
    await uploadAndWait([failing.id]);
    await addItem(deps, chu(5));

    const { items } = await list();
    // Unit 4 failed, so it's back with what isn't uploaded
    expect(items.map((i) => i.summary.title)).toEqual(['Unit 5', 'Unit 4', 'Unit 3', 'Unit 2', 'Unit 1']);
    const groups = items.map(uploadGroup);
    expect(groups[0]).toBe('');
    expect(groups[1]).toBe('');
    expect(groups[2]).toBe(groups[3]);
    expect(groups[3]).not.toBe(groups[4]);
    expect(items[4]).toMatchObject({ id: one.id, upload: { startedAt: expect.any(String) } });
  });

  it('finds the places each upload created, for downloading its logins', async () => {
    await addItem(deps, chu(1));
    await uploadAndWait();
    await addItem(deps, chu(2));
    await addItem(deps, chu(3));
    await uploadAndWait();
    await addItem(deps, chu(4));

    const { items } = await list();
    const latest = items.find((i) => i.summary.title === 'Unit 2')!.upload!;
    expect((await placesCreatedBy(deps, latest.runId)).placeIds.sort()).toEqual(['place-2', 'place-3']);
    expect(await placesCreatedBy(deps, latest.runId)).toMatchObject({ startedAt: latest.startedAt });
    expect((await placesCreatedBy(deps, 'nope')).placeIds).toEqual([]);
  });

  it('shows the most recently added first, keeping the rows of one CSV upload together in file order', async () => {
    await addItem(deps, chu(1));
    const header = '"Sub County","CHU Name","CHU Code","Link Facility Name","Link Facility MFL Code","CHA Name","CHA Phone"';
    const row = (n: number) =>
      `Kisumu West,Unit ${n},${100000 + n},Kanyakwar Dispensary,12345,worker ${n},07123456${String(n).padStart(2, '0')}`;
    await stageCsv(deps, { fileName: 'units.csv', text: [header, row(2), row(3), row(4)].join('\n'), contactType: CHU });
    await new Promise((resolve) => setTimeout(resolve, 2));
    await addItem(deps, chu(5));

    expect((await list()).items.map((i) => i.summary.title)).toEqual(['Unit 5', 'Unit 2', 'Unit 3', 'Unit 4', 'Unit 1']);
  });
});
