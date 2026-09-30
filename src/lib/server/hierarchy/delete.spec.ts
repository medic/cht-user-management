import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Instance } from '../auth/instances';
import type { Session } from '../auth/session';
import { ApiError } from '../errors';
import type { JobSettings } from '../settings';
import { fakeChtConf } from '../testing/fake-cht-conf';
import { FakeCht } from '../testing/fake-cht';
import { archivePath, previewDelete, readArchive, type DeleteRequest } from './delete';
import { MemoryJobStore } from './jobs';
import { JobRunner } from './runner';
import { resumeJob, scheduleJob, view, type JobDeps } from './service';
import { stageCsv } from '../staged/csv';
import { addItem, confirmItem, confirmMany, listItems, listQuery, startUpload, type StagedDeps } from '../staged/service';
import { MemoryStagedStore } from '../staged/store';
import { MemoryUploadTracker } from '../staged/upload-tracker';
import type { UploadLog, UploadLogRecord } from '../upload-log';
import { undoJob, undoPreview } from './service';

const CHU = 'c_community_health_unit';
const AREA = 'd_community_health_volunteer_area';
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

let cht: FakeCht;
let store: MemoryJobStore;
let dir: string;
let settings: JobSettings;
let deps: JobDeps;
let uploadLog: UploadLog & { records: Omit<UploadLogRecord, 'id'>[] };

// Kisumu › Kisumu West › Kanyakwar (CHU, CHA Jane) › two CHP areas (Mary, Grace), with reports
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cht-iam-delete-'));
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
  const lineage = (...ids: string[]) => ids.reduceRight<any>((parent, id) => ({ _id: id, ...(parent ? { parent } : {}) }), undefined);
  cht = new FakeCht().seed(
    { _id: 'county', type: 'contact', contact_type: 'a_county', name: 'Kisumu' },
    { _id: 'sub', type: 'contact', contact_type: 'b_sub_county', name: 'Kisumu West', parent: lineage('county') },
    { _id: 'chu', type: 'contact', contact_type: CHU, name: 'Kanyakwar', parent: lineage('sub', 'county'), contact: { _id: 'jane' } },
    { _id: 'jane', type: 'person', name: 'Jane', parent: lineage('chu', 'sub', 'county') },
    {
      _id: 'area-1',
      type: 'contact',
      contact_type: AREA,
      name: 'Mary Area',
      parent: lineage('chu', 'sub', 'county'),
      contact: { _id: 'mary' }
    },
    { _id: 'mary', type: 'person', name: 'Mary', parent: lineage('area-1', 'chu', 'sub', 'county') },
    {
      _id: 'area-2',
      type: 'contact',
      contact_type: AREA,
      name: 'Grace Area',
      parent: lineage('chu', 'sub', 'county'),
      contact: { _id: 'grace' }
    },
    { _id: 'grace', type: 'person', name: 'Grace', parent: lineage('area-2', 'chu', 'sub', 'county') },
    { _id: 'report-1', type: 'data_record', form: 'visit', patient_id: 'mary' },
    { _id: 'report-2', type: 'data_record', form: 'visit', place_id: 'area-2' },
    { _id: 'report-elsewhere', type: 'data_record', form: 'visit', patient_id: 'someone-else' }
  );
  cht.seedUser({ username: 'jane', place: ['chu'], contact: 'jane', roles: ['community_health_assistant'] });
  cht.seedUser({ username: 'mary', place: ['area-1'], contact: 'mary', roles: ['community_health_volunteer'] });
  // Grace also serves a place outside the branch, so she only loses one
  cht.seedUser({ username: 'grace', place: ['area-2', 'elsewhere'], contact: 'grace', roles: ['community_health_volunteer'] });
  store = new MemoryJobStore();
  deps = { cht, session, store, workerKey: WORKER_KEY, settings };
  const records: Omit<UploadLogRecord, 'id'>[] = [];
  uploadLog = { records, log: async (_creator, record) => void records.push(record), list: async () => [] };
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const deleteChu = (overrides: Partial<DeleteRequest> = {}): DeleteRequest => ({
  kind: 'delete',
  contactType: CHU,
  placeId: 'chu',
  confirmName: 'Kanyakwar',
  ...overrides
});

function runner(runChtConf = fakeChtConf(cht), now?: () => Date) {
  return new JobRunner({ store, settings, instances: [instance], workerKey: WORKER_KEY, chtFor: () => cht, runChtConf, uploadLog, now });
}

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
  it('shows what will be deleted, who is affected, and where', async () => {
    cht.syncs.set('mary', '2026-09-20T08:00:00.000Z');

    const preview = await previewDelete(cht, session, store, deleteChu());

    expect(preview).toMatchObject({
      place: { name: 'Kanyakwar', location: 'Kisumu › Kisumu West › Kanyakwar' },
      counts: { places: 3, people: 3, reports: 2 },
      large: false,
      lastSyncKnown: true,
      confirmName: 'Kanyakwar'
    });
    expect(preview.accounts.sort((a, b) => a.username.localeCompare(b.username))).toEqual([
      { username: 'grace', places: ['Grace Area'], action: 'lose_places', lastSync: null },
      { username: 'jane', places: ['Kanyakwar'], action: 'retire', lastSync: null },
      { username: 'mary', places: ['Mary Area'], action: 'retire', lastSync: '2026-09-20T08:00:00.000Z' }
    ]);
  });

  it('only schedules with the place’s name typed exactly', async () => {
    const error = await expectApiError(
      scheduleJob(deps, '00000000-0000-4000-8000-000000000001', deleteChu({ confirmName: 'kanyakwar' })),
      'CONFIRMATION_REQUIRED'
    );
    expect(error.details).toEqual({ expected: 'Kanyakwar' });
  });

  it('refuses to leave a place above pointing at a deleted person', async () => {
    cht.docs.get('sub')!.contact = { _id: 'jane' };
    await expectApiError(scheduleJob(deps, '00000000-0000-4000-8000-000000000001', deleteChu()), 'PRIMARY_CONTACT_WOULD_BE_LOST');
  });

  it('refuses a job overlapping another job’s branch, and returns the same job for the same id', async () => {
    const first = await scheduleJob(deps, '00000000-0000-4000-8000-000000000001', deleteChu());
    expect(first).toMatchObject({ status: 202, job: { status: 'queued', branch: { placeId: 'chu', lineage: ['sub', 'county'] } } });
    expect(await scheduleJob(deps, '00000000-0000-4000-8000-000000000001', deleteChu())).toMatchObject({
      status: 200,
      job: { id: '00000000-0000-4000-8000-000000000001' }
    });

    const area = { kind: 'delete' as const, contactType: AREA, placeId: 'area-1', confirmName: 'Mary Area' };
    await expectApiError(scheduleJob(deps, '00000000-0000-4000-8000-000000000002', area), 'OVERLAPPING_JOB');
    // never shown to clients
    expect(await view(store, first.job)).not.toHaveProperty('token');
  });
});

describe('running a delete', () => {
  it('keeps a copy, has cht-conf delete everything under the place, and records the outcome', async () => {
    const chtConf = fakeChtConf(cht);
    const { job } = await scheduleJob(deps, '00000000-0000-4000-8000-000000000001', deleteChu());

    await runner(chtConf).tick();

    const done = (await store.get('test', '00000000-0000-4000-8000-000000000001'))!;
    expect(done).toMatchObject({
      status: 'done',
      phase: 'uploaded',
      result: { contacts: 6, reports: 2, usersDisabled: 2, usersUpdated: 1 },
      progress: { written: 8, total: 8 },
      archive: { available: true, docs: 8 }
    });
    expect(done.token).toBeUndefined();
    // cht-conf's own actions, in the job's folder, with the session and never on a command line
    expect(chtConf.runs.map((r) => r.action)).toEqual(['delete-contacts', 'upload-docs']);
    expect(chtConf.runs[0].args).toEqual([
      '--contacts=chu',
      '--disable-users',
      `--docDirectoryPath=${join(settings.workDir, job.id, 'json_docs')}`
    ]);
    expect(chtConf.runs[0].sessionToken).toBe('abc');
    expect(existsSync(join(settings.workDir, job.id))).toBe(false);

    expect(['chu', 'jane', 'area-1', 'mary', 'area-2', 'grace', 'report-1', 'report-2'].some((id) => cht.docs.has(id))).toBe(false);
    expect(cht.docs.has('report-elsewhere') && cht.docs.has('sub')).toBe(true);
    expect(cht.users.get('jane')?.inactive).toBe(true);
    expect(cht.users.get('grace')).toMatchObject({ place: ['elsewhere'] });

    const archived: string[] = [];
    for await (const doc of readArchive(archivePath(settings.archiveDir, done))) archived.push(doc._id);
    expect(archived.sort()).toEqual(['area-1', 'area-2', 'chu', 'grace', 'jane', 'mary', 'report-1', 'report-2']);
    expect((await store.log('test', '00000000-0000-4000-8000-000000000001')).join('\n')).toMatch(/Kept a copy of 8 docs/);
  });

  it('waits while Sentinel is busy, then runs once it’s due', async () => {
    let now = new Date('2026-09-30T10:00:00Z');
    await scheduleJob(deps, '00000000-0000-4000-8000-000000000001', deleteChu());
    cht.sentinel = 9120;

    await runner(fakeChtConf(cht), () => now).tick();
    expect(await store.get('test', '00000000-0000-4000-8000-000000000001')).toMatchObject({
      status: 'postponed',
      postponed: { reason: 'sentinel_backlog', backlog: 9120, nextCheckAt: '2026-09-30T10:15:00.000Z' }
    });

    cht.sentinel = 10;
    await runner(fakeChtConf(cht), () => now).tick();
    expect((await store.get('test', '00000000-0000-4000-8000-000000000001'))?.status).toBe('postponed');

    now = new Date('2026-09-30T10:16:00Z');
    await runner(fakeChtConf(cht), () => now).tick();
    expect((await store.get('test', '00000000-0000-4000-8000-000000000001'))?.status).toBe('done');
  });

  it('asks for sign-in when the session it carries has expired, and runs again once resumed', async () => {
    await scheduleJob(deps, '00000000-0000-4000-8000-000000000001', deleteChu());

    await runner(fakeChtConf(cht), () => new Date(Date.now() + 2 * 86_400_000)).tick();
    expect((await store.get('test', '00000000-0000-4000-8000-000000000001'))?.status).toBe('needs_sign_in');
    expect(cht.docs.has('chu')).toBe(true);

    expect(await resumeJob(deps, '00000000-0000-4000-8000-000000000001')).toMatchObject({ status: 'queued' });
    await runner().tick();
    expect((await store.get('test', '00000000-0000-4000-8000-000000000001'))?.status).toBe('done');
  });

  it('fails with the end of the log, and a retry runs it again', async () => {
    await scheduleJob(deps, '00000000-0000-4000-8000-000000000001', deleteChu());

    await runner(fakeChtConf(cht, { fail: 'upload-docs' })).tick();
    const failed = (await store.get('test', '00000000-0000-4000-8000-000000000001'))!;
    expect(failed).toMatchObject({ status: 'failed', phase: 'archived', error: { message: 'cht-conf upload-docs exited with 1' } });
    expect(failed.error?.logTail.join('\n')).toMatch(/something went wrong/);
    expect(cht.docs.has('chu')).toBe(true);

    await resumeJob(deps, '00000000-0000-4000-8000-000000000001');
    await runner().tick();
    expect(await store.get('test', '00000000-0000-4000-8000-000000000001')).toMatchObject({
      status: 'done',
      attempts: 2,
      archive: { docs: 8 }
    });
  });

  it('finishes a job whose deletions were written before its server stopped', async () => {
    const { job } = await scheduleJob(deps, '00000000-0000-4000-8000-000000000001', deleteChu());
    await store.save({ ...job, status: 'running', phase: 'uploaded' });
    cht.docs.delete('chu');

    await runner().tick();

    expect((await store.get('test', '00000000-0000-4000-8000-000000000001'))?.status).toBe('done');
  });
});

describe('delete items in the staged list', () => {
  const owner = { instanceId: 'test', username: 'manager' };
  const noLog = { log: async () => undefined, list: async () => [] };
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
  const item = (overrides: Record<string, unknown> = {}) => ({
    kind: 'delete' as const,
    request: { jobId: '00000000-0000-4000-8000-000000000001', contactType: CHU, placeId: 'chu', confirmName: 'Kanyakwar', ...overrides }
  });
  async function waitFor(check: () => Promise<boolean>) {
    for (let i = 0; i < 400 && !(await check()); i++) await new Promise((resolve) => setTimeout(resolve, 5));
  }

  it('adds a confirmed delete from the form, saying what it removes', async () => {
    const added = await addItem(staged, item());

    expect(added).toMatchObject({
      kind: 'delete',
      status: 'ready',
      claims: ['chu', 'sub', 'county'],
      summary: {
        title: 'Kanyakwar',
        subtitle: 'Kisumu › Kisumu West',
        person: 'Deletes 3 places, 3 people and 2 reports; 2 accounts retired'
      }
    });
    await expectApiError(
      addItem(staged, item({ jobId: '00000000-0000-4000-8000-000000000002', confirmName: 'Kanyakwa' })),
      'CONFIRMATION_REQUIRED'
    );
    // a place under it, or above it, overlaps
    await expectApiError(
      addItem(
        staged,
        item({ jobId: '00000000-0000-4000-8000-000000000003', contactType: AREA, placeId: 'area-1', confirmName: 'Mary Area' })
      ),
      'DELETE_ALREADY_STAGED'
    );
  });

  it('schedules the job on upload, and shows the job’s status on the item', async () => {
    const added = await addItem(staged, item());

    await startUpload(staged);
    await waitFor(async () => (await staged.tracker.state(owner)).state === 'idle');
    let listed = (await listItems(staged, listQuery.parse({}))).items[0];
    expect(listed).toMatchObject({
      status: 'created',
      result: { jobId: '00000000-0000-4000-8000-000000000001' },
      job: { id: '00000000-0000-4000-8000-000000000001', status: 'queued', position: 1 }
    });
    expect(listed.job).not.toHaveProperty('token');
    expect(cht.docs.has('chu')).toBe(true);

    await runner().tick();
    listed = (await listItems(staged, listQuery.parse({}))).items[0];
    expect(listed).toMatchObject({ id: added.id, job: { status: 'done', result: { contacts: 6, reports: 2 } } });
    expect(cht.docs.has('chu')).toBe(false);
  });

  it('stages CSV rows to wait for their name to be typed', async () => {
    const csv = ['"Sub County","Community Health Unit"', 'Kisumu West,Kanyakwar', 'Kisumu West,Nowhere'].join('\n');
    await stageCsv(staged, { fileName: 'closing.csv', text: csv, contactType: CHU, kind: 'delete' });
    await waitFor(
      async () =>
        (await staged.validationTracker.state(owner)).state === 'idle' &&
        (await staged.store.list(owner)).every((i) => i.status !== 'pending')
    );

    const [kanyakwar, nowhere] = (await listItems(staged, listQuery.parse({ file: 'closing.csv' }))).items;
    expect(kanyakwar).toMatchObject({
      status: 'needs_confirmation',
      confirmation: { reason: 'typed_name', expected: 'Kanyakwar' },
      request: { placeId: 'chu' }
    });
    expect(nowhere.errors?.place).toMatch(/Can't find Community Health Unit "Nowhere"/);

    // never in bulk, and only with the name typed exactly
    expect(await confirmMany(staged, [kanyakwar.id])).toEqual({ confirmed: [], skipped: [kanyakwar.id] });
    const confirmed = await confirmItem(staged, kanyakwar.id, { revision: kanyakwar.revision, confirmName: 'Kanyakwar' });
    expect(confirmed).toMatchObject({ status: 'ready', request: { confirmName: 'Kanyakwar' } });
  });
});

describe('undoing a delete', () => {
  async function deleted() {
    await scheduleJob(deps, '00000000-0000-4000-8000-000000000001', deleteChu());
    await runner().tick();
    expect((await store.get('test', '00000000-0000-4000-8000-000000000001'))?.status).toBe('done');
  }

  it('shows what will come back, and whose accounts the delete affected', async () => {
    await deleted();

    expect(await undoPreview(deps, '00000000-0000-4000-8000-000000000001')).toMatchObject({
      placeName: 'Kanyakwar',
      counts: { contacts: 6, reports: 2 },
      parent: { id: 'sub', name: 'Kisumu West' },
      accounts: expect.arrayContaining([
        { username: 'jane', places: ['Kanyakwar'], disabled: true },
        { username: 'grace', places: ['Grace Area'], disabled: false }
      ])
    });
  });

  it('restores every doc with cht-conf, gives places back, and only recreates logins when asked', async () => {
    await deleted();
    const before = { ...cht.users.get('jane')! };

    const { status, job } = await undoJob(deps, '00000000-0000-4000-8000-000000000001', { recreateLogins: false });
    expect(status).toBe(202);
    expect(job).toMatchObject({ id: '00000000-0000-4000-8000-000000000001-undo', kind: 'restore', status: 'queued' });
    expect(await undoJob(deps, '00000000-0000-4000-8000-000000000001', { recreateLogins: false })).toMatchObject({ status: 200 });
    await runner().tick();

    const restore = (await store.get('test', '00000000-0000-4000-8000-000000000001-undo'))!;
    expect(restore).toMatchObject({ status: 'done', result: { contacts: 6, reports: 2, accountsRestored: 1, loginsRecreated: [] } });
    for (const id of ['chu', 'jane', 'area-1', 'mary', 'area-2', 'grace', 'report-1', 'report-2']) expect(cht.docs.has(id)).toBe(true);
    expect(cht.docs.get('chu')).toMatchObject({ name: 'Kanyakwar', contact: { _id: 'jane' } });
    // Grace kept her login, and gets her place back; Jane's stays disabled
    expect(cht.users.get('grace')?.place.sort()).toEqual(['area-2', 'elsewhere']);
    expect(cht.users.get('jane')).toMatchObject({ inactive: before.inactive });
    expect(uploadLog.records).toHaveLength(0);
    expect((await store.get('test', '00000000-0000-4000-8000-000000000001'))?.undoneBy).toBe('00000000-0000-4000-8000-000000000001-undo');
  });

  it('recreates logins for disabled accounts when asked, with new passwords on record', async () => {
    await deleted();
    // what CHT keeps of a disabled account: its settings, marked inactive
    cht.seed(
      {
        _id: 'org.couchdb.user:jane',
        type: 'user-settings',
        name: 'jane',
        contact_id: 'jane',
        roles: ['community_health_assistant'],
        facility_id: ['chu'],
        fullname: 'Jane',
        phone: '+254712345678',
        inactive: true
      },
      {
        _id: 'org.couchdb.user:mary',
        type: 'user-settings',
        name: 'mary',
        contact_id: 'mary',
        roles: ['community_health_volunteer'],
        facility_id: ['area-1'],
        fullname: 'Mary',
        inactive: true
      }
    );
    cht.users.delete('jane');
    cht.users.delete('mary');

    await undoJob(deps, '00000000-0000-4000-8000-000000000001', { recreateLogins: true });
    await runner().tick();

    expect((await store.get('test', '00000000-0000-4000-8000-000000000001-undo'))?.result?.loginsRecreated).toEqual(
      expect.arrayContaining([
        { username: 'jane', previousUsername: 'jane' },
        { username: 'mary', previousUsername: 'mary' }
      ])
    );
    expect(cht.users.get('jane')).toMatchObject({ contact: 'jane', place: ['chu'], roles: ['community_health_assistant'] });
    expect(uploadLog.records.map((r) => r.credentials.username).sort()).toEqual(['jane', 'mary']);
  });

  it('refuses when the place above is gone, or the ids are in use again', async () => {
    await deleted();
    cht.seed({ _id: 'mary', type: 'person', name: 'Someone new' });
    await expectApiError(undoJob(deps, '00000000-0000-4000-8000-000000000001', { recreateLogins: false }), 'UNDO_CONFLICT');

    cht.docs.delete('mary');
    cht.docs.delete('sub');
    await expectApiError(undoJob(deps, '00000000-0000-4000-8000-000000000001', { recreateLogins: false }), 'PARENT_GONE');
  });
});
