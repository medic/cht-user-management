import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { createGunzip, createGzip } from 'node:zlib';
import { within } from '../paths';
import { z } from 'zod';

import { assertAuthorized, type Session } from '../auth/session';
import type { Cht, CouchDoc } from '../cht/client';
import { getContactType } from '../config';
import { ApiError } from '../errors';
import { contactRef, docType, lineageIds, personCheck } from '../places/documents';
import { namesOf } from '../places/directory';
import { docId } from '../places/schemas';
import { authSessionValue, type ChtConfRunner } from './cht-conf';
import type { HierarchyJob, JobStore } from './jobs';

// APP.md → Deleting places. The work is cht-conf's: `delete-contacts` stages the deletions and
// `upload-docs --disable-users` writes them and handles the accounts. The app checks before
// scheduling, shows the impact, keeps a copy of every doc first, and records the outcome.

export const deleteRequest = z
  .object({
    kind: z.literal('delete'),
    contactType: z.string().min(1),
    placeId: docId,
    // the place's name, typed by the user: a guard for machine clients too
    confirmName: z.string()
  })
  .strict();
export type DeleteRequest = z.infer<typeof deleteRequest>;

const MAX_DEPTH = 20;
const LARGE = 100;

// Checks before scheduling (APP.md → Deleting places → Checks before scheduling)
export async function checkDelete(
  cht: Cht,
  session: Session,
  jobs: JobStore,
  request: Omit<DeleteRequest, 'confirmName'> & { confirmName?: string },
  options: { jobId?: string; requireConfirmation: boolean }
): Promise<{ placeDoc: CouchDoc; ancestors: CouchDoc[] }> {
  const contactType = getContactType(request.contactType, 'delete');
  const placeDoc = await cht.getDoc(request.placeId);
  if (!placeDoc) {
    throw new ApiError(404, 'PLACE_NOT_FOUND', `place "${request.placeId}" was not found`);
  }
  if (docType(placeDoc) !== contactType.name) {
    throw new ApiError(422, 'PLACE_WRONG_TYPE', `place "${request.placeId}" is a "${docType(placeDoc)}", not a "${contactType.name}"`);
  }
  assertAuthorized(session, [placeDoc._id, ...lineageIds(placeDoc)]);

  if (options.requireConfirmation && request.confirmName?.trim() !== String(placeDoc.name ?? '')) {
    throw new ApiError(422, 'CONFIRMATION_REQUIRED', `Type "${placeDoc.name}" exactly to confirm.`, { expected: placeDoc.name });
  }

  await assertNoOverlappingJob(jobs, session.instanceId, placeDoc, options.jobId);

  // an ancestor whose primary contact is inside the branch would be left pointing at a deleted person
  const ancestors = await cht.getDocs(lineageIds(placeDoc));
  const contactIds = [...new Set(ancestors.map((doc) => contactRef(doc.contact)).filter((id): id is string => !!id))];
  const contacts = new Map((contactIds.length ? await cht.getDocs(contactIds) : []).map((doc) => [doc._id, doc]));
  for (const ancestor of ancestors) {
    const contact = contacts.get(contactRef(ancestor.contact) ?? '');
    if (contact && lineageIds(contact).includes(placeDoc._id)) {
      throw new ApiError(
        422,
        'PRIMARY_CONTACT_WOULD_BE_LOST',
        `Can't delete ${placeDoc.name}: ${contact.name} is the primary contact of ${ancestor.name}`,
        { ancestorId: ancestor._id, contactId: contact._id }
      );
    }
  }
  return { placeDoc, ancestors };
}

// Two jobs rewriting or deleting the same branch would overwrite each other: a job for this place,
// anything above it, or anything under it
export async function assertNoOverlappingJob(jobs: JobStore, instanceId: string, placeDoc: CouchDoc, jobId?: string): Promise<void> {
  const lineage = lineageIds(placeDoc);
  const overlapping = (await jobs.queue(instanceId)).find(
    (job) =>
      job.id !== jobId &&
      (job.branch.placeId === placeDoc._id || lineage.includes(job.branch.placeId) || job.branch.lineage.includes(placeDoc._id))
  );
  if (overlapping) {
    throw new ApiError(409, 'OVERLAPPING_JOB', `${placeDoc.name} is already part of a scheduled move, merge or delete`, {
      jobId: overlapping.id
    });
  }
}

export type DeletePreview = {
  place: { id: string; name: string; location: string };
  counts: { places: number; people: number; reports: number };
  large: boolean;
  accounts: { username: string; places: string[]; action: 'retire' | 'lose_places'; lastSync: string | null }[];
  lastSyncKnown: boolean;
  confirmName: string;
};

// What a delete will remove (APP.md → Deleting places → Showing the impact). Counted the way
// cht-conf finds them: everything under the place in contacts_by_depth, and the reports whose subject
// is one of those contacts' ids.
export async function previewDelete(
  cht: Cht,
  session: Session,
  jobs: JobStore,
  request: Omit<DeleteRequest, 'confirmName'>
): Promise<DeletePreview> {
  const { placeDoc, ancestors } = await checkDelete(cht, session, jobs, request, { requireConfirmation: false });
  const branch = await cht.docsAtDepth(
    placeDoc._id,
    Array.from({ length: MAX_DEPTH + 1 }, (_, depth) => depth)
  );
  const people = branch.filter(await personCheck(cht));
  const places = branch.filter((doc) => !people.includes(doc));
  const reports = await cht.countReportsAbout(branch.map((doc) => doc._id));

  const accounts = new Map<string, { places: Set<string>; all: string[] }>();
  for (let start = 0; start < places.length; start += 8) {
    const batch = await Promise.all(places.slice(start, start + 8).map((place) => cht.usersAtPlace(place._id)));
    batch.flat().forEach((user) => {
      const entry = accounts.get(user.username) ?? { places: new Set<string>(), all: user.placeIds };
      user.placeIds.filter((id) => places.some((place) => place._id === id)).forEach((id) => entry.places.add(id));
      accounts.set(user.username, entry);
    });
  }
  const syncs = session.isAdmin ? await cht.lastSyncs([...accounts.keys()]) : new Map<string, string | null>();
  const names = await namesOf(
    cht,
    [...accounts.values()].flatMap((a) => [...a.places])
  );
  const byId = new Map(ancestors.map((doc) => [doc._id, doc]));
  const location = [
    ...lineageIds(placeDoc)
      .map((id) => String(byId.get(id)?.name ?? ''))
      .reverse(),
    String(placeDoc.name ?? '')
  ]
    .filter(Boolean)
    .join(' › ');

  return {
    place: { id: placeDoc._id, name: String(placeDoc.name ?? ''), location },
    counts: { places: places.length, people: people.length, reports },
    large: branch.length > LARGE,
    accounts: [...accounts].map(([username, { places: held, all }]) => ({
      username,
      places: [...held].map((id) => names.get(id) ?? id),
      action: all.every((id) => held.has(id)) ? 'retire' : 'lose_places',
      lastSync: syncs.get(username) ?? null
    })),
    lastSyncKnown: session.isAdmin,
    confirmName: String(placeDoc.name ?? '')
  };
}

// ---- running the job

export type DeleteRun = {
  job: HierarchyJob;
  cht: Cht;
  instanceUrl: string;
  sessionCookie: string;
  runChtConf: ChtConfRunner;
  workDir: string;
  archiveDir: string;
  archiveTtlSeconds: number;
  log: (line: string) => void;
  // saves the job's progress as the run goes
  update: (change: Partial<HierarchyJob>) => Promise<HierarchyJob>;
};

const STAGED = /\.doc\.json$/;

// APP.md → Deleting places → Running the job
export async function runDelete(run: DeleteRun): Promise<HierarchyJob> {
  const { job, cht } = run;
  const placeId = job.request.placeId as string;
  const started = Date.now();
  const workDir = within(run.workDir, job.id);
  const docs = join(workDir, 'json_docs');
  const chtConf = (action: 'delete-contacts' | 'upload-docs', args: string[]) =>
    run.runChtConf({
      action,
      args,
      workDir,
      instanceUrl: run.instanceUrl,
      sessionToken: authSessionValue(run.sessionCookie),
      onLine: run.log
    });

  if (!(await cht.getDoc(placeId))) {
    // cht-conf can't work out a delete once the place is gone (APP.md → Deleting places → Known issues)
    if (job.phase === 'uploaded' || job.phase === 'archived') {
      run.log(`${job.branch.placeName} is already deleted.`);
      return run.update({
        status: 'done',
        finishedAt: new Date().toISOString(),
        result: job.result ?? { contacts: 0, reports: 0, usersDisabled: 0, usersUpdated: 0, durationMs: 0 }
      });
    }
    throw new ApiError(404, 'PLACE_NOT_FOUND', `${job.branch.placeName} no longer exists, so there's nothing for cht-conf to delete`);
  }

  try {
    await rm(workDir, { recursive: true, force: true });
    await mkdir(workDir, { recursive: true });

    // 1. cht-conf works out every doc to delete, and stages them in this job's folder
    run.log(`Working out what to delete under ${job.branch.placeName}…`);
    await chtConf('delete-contacts', [`--contacts=${placeId}`, '--disable-users', `--docDirectoryPath=${docs}`]);
    const staged = existsSync(docs) ? (await readdir(docs)).filter((name) => STAGED.test(name)) : [];
    const ids = staged.map((name) => name.replace(STAGED, ''));
    run.log(`cht-conf staged ${ids.length} docs to delete.`);
    await run.update({ phase: 'staged', progress: { written: 0, total: ids.length } });

    // 2. a copy of every one of them, and the accounts at them, before anything is deleted
    const archived = await archive(run, ids);
    const kinds = await kindsOf(run, ids);
    const accounts = job.accounts ?? (await accountsAt(cht, kinds.placeIds));
    await run.update({
      phase: 'archived',
      accounts,
      archive: { available: true, docs: archived, expiresAt: new Date(Date.now() + run.archiveTtlSeconds * 1000).toISOString() }
    });

    // 3. cht-conf writes the deletions and handles the accounts at the deleted places
    const users = { disabled: 0, updated: 0 };
    await run.runChtConf({
      action: 'upload-docs',
      args: [`--docDirectoryPath=${docs}`],
      workDir,
      instanceUrl: run.instanceUrl,
      sessionToken: authSessionValue(run.sessionCookie),
      onLine: (line) => {
        run.log(line);
        const progress = line.match(/(\d+)\/(\d+) docs/);
        if (progress) void run.update({ progress: { written: Number(progress[1]), total: Number(progress[2]) } });
        const accounts = line.match(/(\d+) users disabled\. (\d+) users updated/);
        if (accounts) [users.disabled, users.updated] = [Number(accounts[1]), Number(accounts[2])];
      }
    });
    await run.update({ phase: 'uploaded' });

    // 4. what cht-conf reports, and that the place is gone
    const failed = await uploadFailures(workDir);
    if (failed.length) {
      throw new ApiError(
        502,
        'UPLOAD_INCOMPLETE',
        `cht-conf couldn't delete ${failed.length} of ${ids.length} docs, eg. ${failed.slice(0, 3).join('; ')}`
      );
    }
    if (await cht.getDoc(placeId)) {
      throw new ApiError(502, 'NOT_DELETED', `${job.branch.placeName} still exists after the upload`);
    }
    run.log(`Deleted ${kinds.contacts} contacts and ${kinds.reports} reports.`);
    return run.update({
      status: 'done',
      finishedAt: new Date().toISOString(),
      progress: { written: ids.length, total: ids.length },
      result: {
        contacts: kinds.contacts,
        reports: kinds.reports,
        usersDisabled: users.disabled,
        usersUpdated: users.updated,
        durationMs: Date.now() - started
      }
    });
  } finally {
    // the staging folder is the job's own, and goes when it ends
    await rm(workDir, { recursive: true, force: true });
  }
}

export function archivePath(archiveDir: string, job: Pick<HierarchyJob, 'instanceId' | 'id'>): string {
  return within(archiveDir, job.instanceId, `${job.id}.ndjson.gz`);
}

// Every staged doc, in full, as one JSON doc per line, gzipped. A re-run adds only docs not already
// kept, so the first, most complete copy stays.
export async function archive(run: Pick<DeleteRun, 'cht' | 'archiveDir' | 'job' | 'log'>, ids: string[]): Promise<number> {
  const path = archivePath(run.archiveDir, run.job);
  await mkdir(dirname(path), { recursive: true });
  const kept = existsSync(path) ? await archivedIds(path) : new Set<string>();
  const missing = ids.filter((id) => !kept.has(id));
  if (!missing.length) {
    return kept.size;
  }

  const gzip = createGzip();
  const out = createWriteStream(path, { flags: 'a' });
  const finished = new Promise((resolve, reject) => {
    out.on('finish', resolve);
    out.on('error', reject);
  });
  gzip.pipe(out);
  for (let start = 0; start < missing.length; start += 200) {
    for (const doc of await run.cht.getDocs(missing.slice(start, start + 200), { attachments: true })) {
      gzip.write(JSON.stringify(doc) + '\n');
    }
  }
  gzip.end();
  await finished;
  run.log(`Kept a copy of ${missing.length} docs in the archive.`);
  return kept.size + missing.length;
}

// gzip members appended one after another read back as one stream
async function archivedIds(path: string): Promise<Set<string>> {
  const ids = new Set<string>();
  const lines = createInterface({ input: createReadStream(path).pipe(createGunzip()) });
  for await (const line of lines) {
    if (line.trim()) ids.add(JSON.parse(line)._id);
  }
  return ids;
}

async function kindsOf(run: DeleteRun, ids: string[]): Promise<{ contacts: number; reports: number; placeIds: string[] }> {
  let reports = 0;
  const placeIds: string[] = [];
  for await (const doc of readArchive(archivePath(run.archiveDir, run.job))) {
    if (!ids.includes(doc._id)) continue;
    if (doc.type === 'data_record') reports++;
    else if (doc.type !== 'person' && doc.contact_type !== 'person') placeIds.push(doc._id);
  }
  return { contacts: ids.length - reports, reports, placeIds };
}

// Every account at the places about to be deleted: which of those places it holds, and whether it's
// left with none, so cht-conf will disable it
async function accountsAt(cht: Cht, placeIds: string[]): Promise<NonNullable<HierarchyJob['accounts']>> {
  const accounts = new Map<string, { placeIds: Set<string>; all: string[]; contactId?: string }>();
  for (let start = 0; start < placeIds.length; start += 8) {
    const found = await Promise.all(placeIds.slice(start, start + 8).map((id) => cht.usersAtPlace(id)));
    for (const user of found.flat()) {
      const entry = accounts.get(user.username) ?? { placeIds: new Set<string>(), all: user.placeIds, contactId: user.contactId };
      user.placeIds.filter((id) => placeIds.includes(id)).forEach((id) => entry.placeIds.add(id));
      accounts.set(user.username, entry);
    }
  }
  return [...accounts].map(([username, { placeIds: held, all, contactId }]) => ({
    username,
    contactId,
    placeIds: [...held],
    disabled: all.every((id) => held.has(id))
  }));
}

export async function* readArchive(path: string): AsyncGenerator<CouchDoc> {
  const lines = createInterface({ input: createReadStream(path).pipe(createGunzip()) });
  for await (const line of lines) {
    if (line.trim()) yield JSON.parse(line);
  }
}

// cht-conf's upload-docs report, written in its working folder: { ok: [ids], failed: { id: reason } }
async function uploadFailures(workDir: string): Promise<string[]> {
  const reports = (await readdir(workDir)).filter((name) => /^upload-docs\.\d+\.log\.json$/.test(name)).sort();
  if (!reports.length) return [];
  const report = JSON.parse(await readFile(join(workDir, reports.at(-1)!), 'utf8'));
  return Object.entries(report.failed ?? {}).map(([id, reason]) => `${id}: ${reason}`);
}
