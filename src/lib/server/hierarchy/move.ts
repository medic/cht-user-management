import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { within } from '../paths';
import { z } from 'zod';

import { assertAuthorized, type Session } from '../auth/session';
import type { Cht, CouchDoc } from '../cht/client';
import { getContactType, getParentLevel } from '../config';
import { ApiError } from '../errors';
import { contactRef, docType, lineageIds, personCheck } from '../places/documents';
import { docId } from '../places/schemas';
import { authSessionValue, type ChtConfRunner } from './cht-conf';
import { assertNoOverlappingJob } from './delete';
import type { HierarchyJob, JobStore } from './jobs';

// APP.md → Moving places. cht-conf does the move: `move-contacts` works out every doc whose lineage
// changes and stages them in the job's folder, and `upload-docs` writes them. The app checks before
// scheduling, shows the impact, and records the outcome. cht-conf checks its own constraints again
// when the job runs.

export const moveRequest = z
  .object({
    kind: z.literal('move'),
    contactType: z.string().min(1),
    placeId: docId,
    newParentId: docId
  })
  .strict();
export type MoveRequest = z.infer<typeof moveRequest>;

const MAX_DEPTH = 20;
// past this many places and people, a move is large: it may take hours, and must be confirmed
export const LARGE_MOVE = 100;

// A place's primary contact must be one of its own descendants: an ancestor the branch leaves (one
// not in `staying`) can't have its primary contact inside the branch. Moves and merges both check it.
export async function assertPrimaryContactsStay(
  cht: Cht,
  placeDoc: CouchDoc,
  ancestors: CouchDoc[],
  staying: Set<string>,
  verb: 'move' | 'merge' = 'move'
): Promise<void> {
  const leaving = ancestors.filter((doc) => !staying.has(doc._id));
  const contactIds = [...new Set(leaving.map((doc) => contactRef(doc.contact)).filter((id): id is string => !!id))];
  const contacts = new Map((contactIds.length ? await cht.getDocs(contactIds) : []).map((doc) => [doc._id, doc]));
  for (const ancestor of leaving) {
    const contact = contacts.get(contactRef(ancestor.contact) ?? '');
    if (contact && (contact._id === placeDoc._id || lineageIds(contact).includes(placeDoc._id))) {
      throw new ApiError(
        422,
        'PRIMARY_CONTACT_WOULD_LEAVE',
        `Can't ${verb} ${placeDoc.name}: ${contact.name} is the primary contact of ${ancestor.name}`,
        {
          ancestorId: ancestor._id,
          contactId: contact._id
        }
      );
    }
  }
}

// Checks before scheduling (APP.md → Moving places → Checks before scheduling)
export async function checkMove(
  cht: Cht,
  session: Session,
  jobs: JobStore,
  request: Omit<MoveRequest, 'kind'>,
  options: { jobId?: string } = {}
): Promise<{ placeDoc: CouchDoc; parentDoc: CouchDoc; ancestors: CouchDoc[]; newAncestors: CouchDoc[] }> {
  const contactType = getContactType(request.contactType, 'move');
  // 1. the place
  const placeDoc = await cht.getDoc(request.placeId);
  if (!placeDoc) throw new ApiError(404, 'PLACE_NOT_FOUND', `place "${request.placeId}" was not found`);
  if (docType(placeDoc) !== contactType.name) {
    throw new ApiError(422, 'PLACE_WRONG_TYPE', `place "${request.placeId}" is a "${docType(placeDoc)}", not a "${contactType.name}"`);
  }
  assertAuthorized(session, [placeDoc._id, ...lineageIds(placeDoc)]);

  // 2. the new parent: the type at hierarchy level 1, and one CHT allows for the type
  const parentDoc = await cht.getDoc(request.newParentId);
  if (!parentDoc) throw new ApiError(404, 'PLACE_NOT_FOUND', `new parent "${request.newParentId}" was not found`);
  const levelOne = getParentLevel(contactType).contact_type;
  if (docType(parentDoc) !== levelOne) {
    throw new ApiError(
      422,
      'PLACE_WRONG_TYPE',
      `new parent "${request.newParentId}" is a "${docType(parentDoc)}", expected a "${levelOne}"`
    );
  }
  assertAuthorized(session, [parentDoc._id, ...lineageIds(parentDoc)]);
  const allowed = (await cht.contactTypeSettings()).find((type) => type.id === contactType.name)?.parents ?? [];
  if (!allowed.includes(levelOne)) {
    throw new ApiError(422, 'PARENT_NOT_ALLOWED', `${contactType.friendly} places can't be placed under a ${levelOne}`);
  }

  // 3. no loop
  if (parentDoc._id === placeDoc._id || lineageIds(parentDoc).includes(placeDoc._id)) {
    throw new ApiError(422, 'CIRCULAR_HIERARCHY', `Can't move ${placeDoc.name} under itself`);
  }

  // 4. primary contacts stay inside their place
  const [ancestors, newAncestors] = await Promise.all([
    cht.getDocs(lineageIds(placeDoc)),
    cht.getDocs([parentDoc._id, ...lineageIds(parentDoc)])
  ]);
  await assertPrimaryContactsStay(cht, placeDoc, ancestors, new Set(newAncestors.map((doc) => doc._id)));

  // 5. no other job on this branch
  await assertNoOverlappingJob(jobs, session.instanceId, placeDoc, options.jobId);
  return { placeDoc, parentDoc, ancestors, newAncestors };
}

export type MovePreview = {
  place: { id: string; name: string };
  from: string;
  to: string;
  // the place's current parent already is the new one: re-running finishes an interrupted move
  alreadyThere: boolean;
  counts: { places: number; people: number };
  large: boolean;
  accounts: { username: string; lastSync: string | null }[];
  lastSyncKnown: boolean;
};

// What a move will do (APP.md → Moving places → Showing the impact)
export async function previewMove(cht: Cht, session: Session, jobs: JobStore, request: Omit<MoveRequest, 'kind'>): Promise<MovePreview> {
  const { placeDoc, parentDoc, ancestors, newAncestors } = await checkMove(cht, session, jobs, request);
  const branch = await cht.docsAtDepth(
    placeDoc._id,
    Array.from({ length: MAX_DEPTH + 1 }, (_, depth) => depth)
  );
  const people = branch.filter(await personCheck(cht));
  const accounts = await cht.usersAtPlace(placeDoc._id);
  const syncs = session.isAdmin ? await cht.lastSyncs(accounts.map((a) => a.username)) : new Map<string, string | null>();
  const path = (lineage: string[], docs: CouchDoc[]) => {
    const byId = new Map(docs.map((doc) => [doc._id, String(doc.name ?? doc._id)]));
    return [...lineage.map((id) => byId.get(id) ?? id).reverse(), String(placeDoc.name ?? '')].join(' › ');
  };
  return {
    place: { id: placeDoc._id, name: String(placeDoc.name ?? '') },
    from: path(lineageIds(placeDoc), ancestors),
    to: path([parentDoc._id, ...lineageIds(parentDoc)], newAncestors),
    alreadyThere: placeDoc.parent?._id === parentDoc._id,
    counts: { places: branch.length - people.length, people: people.length },
    large: branch.length > LARGE_MOVE,
    accounts: accounts.map((account) => ({ username: account.username, lastSync: syncs.get(account.username) ?? null })),
    lastSyncKnown: session.isAdmin
  };
}

// ---- running the job

export type MoveRun = {
  job: HierarchyJob;
  cht: Cht;
  instanceUrl: string;
  sessionCookie: string;
  runChtConf: ChtConfRunner;
  workDir: string;
  log: (line: string) => void;
  update: (change: Partial<HierarchyJob>) => Promise<HierarchyJob>;
};

const STAGED = /\.doc\.json$/;

// APP.md → Moving places → Running the job. A re-run is safe: cht-conf only stages docs whose lineage
// is out of date, so it finishes an interrupted move, and writes nothing once it's complete.
export async function runMove(run: MoveRun): Promise<HierarchyJob> {
  const { job, cht } = run;
  const { placeId, newParentId } = job.request as MoveRequest;
  const started = Date.now();
  const workDir = within(run.workDir, job.id);
  const docs = join(workDir, 'json_docs');
  const chtConf = (action: 'move-contacts' | 'upload-docs', args: string[], onLine = run.log) =>
    run.runChtConf({ action, args, workDir, instanceUrl: run.instanceUrl, sessionToken: authSessionValue(run.sessionCookie), onLine });

  try {
    await rm(workDir, { recursive: true, force: true });
    await mkdir(workDir, { recursive: true });

    // 1. cht-conf works out every doc whose lineage changes
    run.log(`Working out what moves with ${job.branch.placeName}…`);
    await chtConf('move-contacts', [`--contacts=${placeId}`, `--parent=${newParentId}`, `--docDirectoryPath=${docs}`]);
    const staged = existsSync(docs) ? (await readdir(docs)).filter((name) => STAGED.test(name)) : [];
    let reports = 0;
    for (const name of staged) {
      if (JSON.parse(await readFile(join(docs, name), 'utf8')).type === 'data_record') reports++;
    }
    run.log(`cht-conf staged ${staged.length} docs to update.`);
    await run.update({ phase: 'staged', progress: { written: 0, total: staged.length } });

    // 2. cht-conf writes them
    if (staged.length) {
      await chtConf('upload-docs', [`--docDirectoryPath=${docs}`], (line) => {
        run.log(line);
        const progress = line.match(/(\d+)\/(\d+) docs/);
        if (progress) void run.update({ progress: { written: Number(progress[1]), total: Number(progress[2]) } });
      });
      const failed = await uploadFailures(workDir);
      if (failed.length) {
        throw new ApiError(
          502,
          'UPLOAD_INCOMPLETE',
          `cht-conf couldn't update ${failed.length} of ${staged.length} docs, eg. ${failed.slice(0, 3).join('; ')}`
        );
      }
    }
    await run.update({ phase: 'uploaded' });

    // 3. the place's parent is now the new one
    const moved = await cht.getDoc(placeId);
    if (moved?.parent?._id !== newParentId) {
      throw new ApiError(502, 'NOT_MOVED', `${job.branch.placeName} isn't under its new parent after the upload`);
    }
    run.log(`Updated ${staged.length - reports} contacts and ${reports} reports.`);
    return run.update({
      status: 'done',
      finishedAt: new Date().toISOString(),
      progress: { written: staged.length, total: staged.length },
      result: { contacts: staged.length - reports, reports, durationMs: Date.now() - started }
    });
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function uploadFailures(workDir: string): Promise<string[]> {
  const reports = (await readdir(workDir)).filter((name) => /^upload-docs\.\d+\.log\.json$/.test(name)).sort();
  if (!reports.length) return [];
  const report = JSON.parse(await readFile(join(workDir, reports.at(-1)!), 'utf8'));
  return Object.entries(report.failed ?? {}).map(([id, reason]) => `${id}: ${reason}`);
}
