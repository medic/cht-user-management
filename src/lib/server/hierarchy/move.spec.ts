import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Instance } from '../auth/instances';
import type { Session } from '../auth/session';
import { ApiError } from '../errors';
import type { JobSettings } from '../settings';
import { stageCsv } from '../staged/csv';
import { addItem, confirmMany, listItems, listQuery, startUpload, type StagedDeps } from '../staged/service';
import { MemoryStagedStore } from '../staged/store';
import { MemoryUploadTracker } from '../staged/upload-tracker';
import { clearPlaceCache, DEFAULT_MAX_PLACES_LOADED, setMaxPlacesLoaded } from '../places/lookup';
import { fakeChtConf } from '../testing/fake-cht-conf';
import { FakeCht } from '../testing/fake-cht';
import { MemoryJobStore } from './jobs';
import { previewMove } from './move';
import { JobRunner } from './runner';
import { scheduleJob, type JobDeps } from './service';

const CHU = 'c_community_health_unit';
const instance: Instance = { id: 'test', name: 'Test', host: 'fake.cht', useHttp: false, idpOrigins: [] };
const session: Session = {
  instanceId: 'test',
  username: 'manager',
  facilityIds: ['*'],
  sessionCookie: 'AuthSession=abc',
  chtVersion: '4.18.0',
  isAdmin: true
};
const WORKER_KEY = 'w'.repeat(40);
const lineage = (...ids: string[]) => ids.reduceRight<any>((parent, id) => ({ _id: id, ...(parent ? { parent } : {}) }), undefined);

let cht: FakeCht;
let store: MemoryJobStore;
let dir: string;
let settings: JobSettings;
let deps: JobDeps;

// Kisumu › Kisumu West › Kanyakwar (CHA Jane) › Mary Area (Mary); Kisumu › Seme, where it moves
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cht-iam-move-'));
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
    {
      _id: 'chu',
      type: 'contact',
      contact_type: CHU,
      name: 'Kanyakwar',
      parent: lineage('west', 'county'),
      contact: { _id: 'jane', parent: lineage('chu', 'west', 'county') }
    },
    { _id: 'jane', type: 'person', name: 'Jane', parent: lineage('chu', 'west', 'county') },
    {
      _id: 'area',
      type: 'contact',
      contact_type: 'd_community_health_volunteer_area',
      name: 'Mary Area',
      parent: lineage('chu', 'west', 'county')
    },
    { _id: 'mary', type: 'person', name: 'Mary', parent: lineage('area', 'chu', 'west', 'county') }
  );
  cht.seedUser({ username: 'jane', place: ['chu'], contact: 'jane', roles: ['community_health_assistant'] });
  store = new MemoryJobStore();
  deps = { cht, session, store, workerKey: WORKER_KEY, settings };
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const move = (overrides: Record<string, string> = {}) => ({
  kind: 'move' as const,
  contactType: CHU,
  placeId: 'chu',
  newParentId: 'seme',
  ...overrides
});
const noLog = { log: async () => undefined, list: async () => [] };
const runner = () =>
  new JobRunner({
    store,
    settings,
    instances: [instance],
    workerKey: WORKER_KEY,
    chtFor: () => cht,
    runChtConf: fakeChtConf(cht),
    uploadLog: noLog
  });

async function expectApiError(promise: Promise<unknown>, code: string): Promise<ApiError> {
  const error = await promise.then(
    () => undefined,
    (e) => e
  );
  expect(error).toBeInstanceOf(ApiError);
  expect(error.code).toBe(code);
  return error;
}

describe('before scheduling', () => {
  it('shows where it goes, how much moves with it, and whose devices re-sync', async () => {
    cht.syncs.set('jane', '2026-09-29T08:00:00.000Z');

    expect(await previewMove(cht, session, store, move())).toEqual({
      place: { id: 'chu', name: 'Kanyakwar' },
      from: 'Kisumu › Kisumu West › Kanyakwar',
      to: 'Kisumu › Seme › Kanyakwar',
      alreadyThere: false,
      counts: { places: 2, people: 2 },
      large: false,
      accounts: [{ username: 'jane', lastSync: '2026-09-29T08:00:00.000Z' }],
      lastSyncKnown: true
    });
  });

  it('only moves under the level-1 type, where CHT allows it, and never under itself', async () => {
    await expectApiError(scheduleJob(deps, '00000000-0000-4000-8000-000000000001', move({ newParentId: 'county' })), 'PLACE_WRONG_TYPE');
    await expectApiError(scheduleJob(deps, '00000000-0000-4000-8000-000000000001', move({ newParentId: 'chu' })), 'PLACE_WRONG_TYPE');
    cht.contactTypes.find((type) => type.id === CHU)!.parents = ['a_county'];
    await expectApiError(scheduleJob(deps, '00000000-0000-4000-8000-000000000001', move()), 'PARENT_NOT_ALLOWED');
  });

  it('refuses to take the primary contact of a place it leaves out from under it', async () => {
    cht.docs.get('west')!.contact = { _id: 'jane' };
    await expectApiError(scheduleJob(deps, '00000000-0000-4000-8000-000000000001', move()), 'PRIMARY_CONTACT_WOULD_LEAVE');
    // staying in the county is fine for the county's contact
    cht.docs.get('west')!.contact = undefined;
    cht.docs.get('county')!.contact = { _id: 'jane' };
    expect((await scheduleJob(deps, '00000000-0000-4000-8000-000000000001', move())).status).toBe(202);
  });
});

describe('running a move', () => {
  it('has cht-conf move the branch, and checks the place is under its new parent', async () => {
    await scheduleJob(deps, '00000000-0000-4000-8000-000000000001', move());

    await runner().tick();

    expect(await store.get('test', '00000000-0000-4000-8000-000000000001')).toMatchObject({
      status: 'done',
      result: { contacts: 4, reports: 0 }
    });
    expect(cht.docs.get('chu')?.parent).toEqual(lineage('seme', 'county'));
    expect(cht.docs.get('mary')?.parent).toEqual(lineage('area', 'chu', 'seme', 'county'));
    // accounts keep their places
    expect(cht.users.get('jane')?.place).toEqual(['chu']);
  });

  it('moves a household to another CHP area, the only action households allow', async () => {
    cht.seed(
      {
        _id: 'area-2',
        type: 'contact',
        contact_type: 'd_community_health_volunteer_area',
        name: 'Ann Area',
        parent: lineage('chu', 'west', 'county')
      },
      {
        _id: 'home',
        type: 'contact',
        contact_type: 'e_household',
        name: 'Otieno Household',
        parent: lineage('area', 'chu', 'west', 'county'),
        contact: { _id: 'head' }
      },
      { _id: 'head', type: 'contact', contact_type: 'f_client', name: 'Otieno', parent: lineage('home', 'area', 'chu', 'west', 'county') }
    );
    const household = move({ contactType: 'e_household', placeId: 'home', newParentId: 'area-2' });
    // only under a CHP area
    await expectApiError(previewMove(cht, session, store, { ...household, newParentId: 'chu' }), 'PLACE_WRONG_TYPE');
    expect(await previewMove(cht, session, store, household)).toMatchObject({
      from: 'Kisumu › Kisumu West › Kanyakwar › Mary Area › Otieno Household',
      to: 'Kisumu › Kisumu West › Kanyakwar › Ann Area › Otieno Household',
      // the head is one of the household's people, not a place
      counts: { places: 1, people: 1 }
    });

    await scheduleJob(deps, '00000000-0000-4000-8000-000000000001', household);
    await runner().tick();

    expect(await store.get('test', '00000000-0000-4000-8000-000000000001')).toMatchObject({ status: 'done' });
    expect(cht.docs.get('home')?.parent).toEqual(lineage('area-2', 'chu', 'west', 'county'));
    expect(cht.docs.get('head')?.parent).toEqual(lineage('home', 'area-2', 'chu', 'west', 'county'));
  });

  it('re-runs a move to where the place already is, writing nothing', async () => {
    await scheduleJob(deps, '00000000-0000-4000-8000-000000000001', move());
    await runner().tick();

    const again = await scheduleJob(deps, '00000000-0000-4000-8000-000000000002', move());
    expect(again.status).toBe(202);
    await runner().tick();
    expect(await store.get('test', '00000000-0000-4000-8000-000000000002')).toMatchObject({ status: 'done', result: { contacts: 0 } });
  });
});

describe('move items in the staged list', () => {
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
    kind: 'move' as const,
    request: { jobId: '00000000-0000-4000-8000-000000000001', contactType: CHU, placeId: 'chu', newParentId: 'seme', ...overrides }
  });

  it('adds a move from the form, saying where it goes, and schedules it on upload', async () => {
    const added = await addItem(staged, item());
    expect(added).toMatchObject({
      status: 'ready',
      claims: ['chu', 'west', 'county'],
      targets: ['seme', 'county'],
      summary: { title: 'Kanyakwar', subtitle: 'Kisumu › Kisumu West', person: 'Moves to Kisumu › Seme, with 2 places and 2 people' }
    });
    // the same place again, or a move under a place that's moving
    await expectApiError(addItem(staged, item({ jobId: '00000000-0000-4000-8000-000000000002' })), 'MOVE_ALREADY_STAGED');

    await startUpload(staged);
    await waitFor(async () => (await staged.tracker.state(owner)).state === 'idle');
    expect((await listItems(staged, listQuery.parse({}))).items[0]).toMatchObject({
      status: 'created',
      job: { id: '00000000-0000-4000-8000-000000000001', status: 'queued' }
    });
    await runner().tick();
    expect((await listItems(staged, listQuery.parse({}))).items[0].job).toMatchObject({ status: 'done' });
  });

  it('asks for a large move to be confirmed, in the form and in the list', async () => {
    for (let n = 0; n < 101; n++)
      cht.seed({ _id: `p${n}`, type: 'person', name: `P ${n}`, parent: lineage('area', 'chu', 'west', 'county') });

    await expectApiError(addItem(staged, item()), 'CONFIRMATION_REQUIRED');
    expect((await addItem(staged, item({ acceptLarge: true }))).status).toBe('ready');
  });

  it('finds each CSV row’s place and new parent by name, and holds large ones for confirmation', async () => {
    for (let n = 0; n < 101; n++)
      cht.seed({ _id: `p${n}`, type: 'person', name: `P ${n}`, parent: lineage('area', 'chu', 'west', 'county') });
    const csv = ['"Sub County","Community Health Unit","New Sub County"', 'Kisumu West,Kanyakwar,Seme', 'Kisumu West,Nowhere,Seme'].join(
      '\n'
    );

    await stageCsv(staged, { fileName: 'moves.csv', text: csv, contactType: CHU, kind: 'move' });
    await waitFor(
      async () =>
        (await staged.validationTracker.state(owner)).state === 'idle' &&
        (await staged.store.list(owner)).every((i) => i.status !== 'pending')
    );

    const [kanyakwar, nowhere] = (await listItems(staged, listQuery.parse({ file: 'moves.csv' }))).items;
    expect(kanyakwar).toMatchObject({
      status: 'needs_confirmation',
      confirmation: { reason: 'large_move' },
      request: { placeId: 'chu', newParentId: 'seme' }
    });
    expect(nowhere.errors?.place).toMatch(/Can't find/);
    // large moves may be confirmed together
    expect(await confirmMany(staged, [kanyakwar.id])).toEqual({ confirmed: [kanyakwar.id], skipped: [] });
    expect((await staged.store.get(owner, kanyakwar.id))?.request.acceptLarge).toBe(true);
  });

  it('finds households row by row under their CHP area, never reading every household', async () => {
    clearPlaceCache();
    // three households are "a lot" here, while two sub counties and two CHP areas aren't
    setMaxPlacesLoaded(2);
    try {
      cht.seed(
        {
          _id: 'ann',
          type: 'contact',
          contact_type: 'd_community_health_volunteer_area',
          name: 'Ann Area',
          parent: lineage('chu', 'west', 'county')
        },
        {
          _id: 'home',
          type: 'contact',
          contact_type: 'e_household',
          name: 'Otieno Household',
          parent: lineage('area', 'chu', 'west', 'county')
        },
        {
          _id: 'home-2',
          type: 'contact',
          contact_type: 'e_household',
          name: 'Achieng Household',
          parent: lineage('area', 'chu', 'west', 'county')
        },
        {
          _id: 'home-3',
          type: 'contact',
          contact_type: 'e_household',
          name: 'Otieno Household',
          parent: lineage('ann', 'chu', 'west', 'county')
        }
      );
      const loaded: string[] = [];
      const read = cht.placesOfType.bind(cht);
      cht.placesOfType = (type: string) => (loaded.push(type), read(type));
      const csv = [
        '"Sub County","CHU","CHP Area","Household","New Sub County","New CHU","New CHP Area"',
        'Kisumu West,Kanyakwar,Mary Area,Otieno Household,Kisumu West,Kanyakwar,Ann Area',
        'Kisumu West,Kanyakwar,Mary Area,Nobody Household,Kisumu West,Kanyakwar,Ann Area'
      ].join('\n');

      await stageCsv(staged, { fileName: 'households.csv', text: csv, contactType: 'e_household', kind: 'move' });
      await waitFor(
        async () =>
          (await staged.validationTracker.state(owner)).state === 'idle' &&
          (await staged.store.list(owner)).every((i) => i.status !== 'pending')
      );

      const [otieno, nobody] = (await listItems(staged, listQuery.parse({ file: 'households.csv' }))).items;
      expect(otieno).toMatchObject({ status: 'ready', request: { placeId: 'home', newParentId: 'ann' } });
      expect(nobody.errors?.place).toBe(`Can't find Household "Nobody Household" under "Mary Area"`);
      expect(loaded).not.toContain('e_household');
    } finally {
      setMaxPlacesLoaded(DEFAULT_MAX_PLACES_LOADED);
      clearPlaceCache();
    }
  });
});
