import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';

import { issueToken } from '../auth/tokens';
import type { Session } from '../auth/session';
import type { Cht } from '../cht/client';
import { ApiError } from '../errors';
import { lineageIds } from '../places/documents';
import type { JobSettings } from '../settings';
import { archivePath, checkDelete, type DeleteRequest } from './delete';
import { checkUndo, previewUndo, type UndoPreview } from './restore';
import { checkMove, type MoveRequest } from './move';
import { checkMerge, type MergeRequest } from './merge';
import { newJobId } from '../places/schemas';
import { within } from '../paths';
import { FINISHED, type HierarchyJob, type JobStatus, type JobStore } from './jobs';

// The hierarchy job API (docs/api-contract.md → Hierarchy jobs)

export type JobDeps = { cht: Cht; session: Session; store: JobStore; workerKey: string; settings: JobSettings };

// PUT /hierarchy-jobs/{jobId}: schedules the job, or returns the one this id already scheduled
export async function scheduleJob(
  deps: JobDeps,
  jobId: string,
  request: DeleteRequest | MoveRequest | MergeRequest
): Promise<{ status: 200 | 202; job: HierarchyJob }> {
  const { cht, session, store } = deps;
  // checked where it's received too: here as well, since the id becomes a folder name
  newJobId.parse(jobId);
  const existing = await store.get(session.instanceId, jobId);
  if (existing) {
    if (existing.createdBy !== session.username) {
      throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', `job "${jobId}" belongs to someone else`);
    }
    return { status: 200, job: existing };
  }

  // the branch a job works on: the place moved or deleted, or the source merged away
  let target: HierarchyJob['target'];
  let placeDoc;
  if (request.kind === 'move') {
    placeDoc = (await checkMove(cht, session, store, request, { jobId })).placeDoc;
  } else if (request.kind === 'merge') {
    const { source, destination } = await checkMerge(cht, session, store, request, { jobId, requireConfirmation: true });
    placeDoc = source;
    target = { placeId: destination._id, placeName: String(destination.name ?? destination._id) };
  } else {
    placeDoc = (await checkDelete(cht, session, store, request, { jobId, requireConfirmation: true })).placeDoc;
  }
  const now = new Date().toISOString();
  const job = await store.save({
    id: jobId,
    kind: request.kind,
    instanceId: session.instanceId,
    createdBy: session.username,
    request,
    branch: { placeId: placeDoc._id, placeName: String(placeDoc.name ?? placeDoc._id), lineage: lineageIds(placeDoc) },
    ...(target ? { target } : {}),
    status: 'queued',
    token: await jobToken(deps),
    attempts: 0,
    createdAt: now,
    updatedAt: now
  });
  return { status: 202, job };
}

// The user's CHT session, for the job to run with once its turn comes
async function jobToken(deps: JobDeps): Promise<string> {
  return (await issueToken('job', deps.session, deps.workerKey, deps.settings.ttlSeconds)).token;
}

export type JobView = Omit<HierarchyJob, 'token'> & { position?: number };

// What clients see: never the token; for queued jobs, their place in line
export async function view(store: JobStore, job: HierarchyJob): Promise<JobView> {
  const { token: _token, ...shown } = job;
  if (job.status === 'queued') {
    const queue = (await store.queue(job.instanceId)).filter((other) => !FINISHED.includes(other.status));
    return { ...shown, position: queue.findIndex((other) => other.id === job.id) + 1 };
  }
  return shown;
}

export async function listJobs(
  deps: Pick<JobDeps, 'session' | 'store' | 'cht'>,
  filter: { status?: JobStatus; kind?: string }
): Promise<JobView[]> {
  const jobs = (await deps.store.forUser(deps.session.instanceId, deps.session.username))
    .filter((job) => !filter.status || job.status === filter.status)
    .filter((job) => !filter.kind || job.kind === filter.kind);
  // merges scheduled before the destination was recorded on the job: its name, from CHT
  const unnamed = jobs.filter((job) => job.kind === 'merge' && !job.target).map((job) => String(job.request.destinationId));
  const names = new Map(
    (unnamed.length ? await deps.cht.getDocs([...new Set(unnamed)]) : []).map((doc) => [doc._id, String(doc.name ?? doc._id)])
  );
  return Promise.all(
    jobs.map((job) => {
      const destinationId = String(job.request.destinationId ?? '');
      const target =
        job.kind === 'merge' && !job.target && names.has(destinationId)
          ? { placeId: destinationId, placeName: names.get(destinationId)! }
          : job.target;
      return view(deps.store, { ...job, ...(target ? { target } : {}) });
    })
  );
}

export async function getJob(deps: Pick<JobDeps, 'session' | 'store'>, jobId: string): Promise<HierarchyJob> {
  const job = await deps.store.get(deps.session.instanceId, jobId);
  if (!job || job.createdBy !== deps.session.username) {
    throw new ApiError(404, 'JOB_NOT_FOUND', 'This job was not found. Finished jobs are kept for a limited time.');
  }
  return job;
}

// POST /hierarchy-jobs/{jobId}/resume: for a job waiting for sign-in, or one that failed. It gets the
// caller's current session, and goes back in line. Re-running is safe.
export async function resumeJob(deps: JobDeps, jobId: string): Promise<HierarchyJob> {
  const job = await getJob(deps, jobId);
  if (job.status !== 'needs_sign_in' && job.status !== 'failed') {
    throw new ApiError(409, 'NOT_RESUMABLE', `A ${job.status.replace('_', ' ')} job can't be resumed.`);
  }
  return deps.store.save({
    ...job,
    status: 'queued',
    token: await jobToken(deps),
    error: undefined,
    postponed: undefined,
    finishedAt: undefined
  });
}

// POST /hierarchy-jobs/{jobId}/undo: schedules a restore of a finished delete, from its archive. Its
// id comes from the delete's, so asking again returns the same restore.
export async function undoJob(
  deps: JobDeps,
  jobId: string,
  options: { recreateLogins: boolean }
): Promise<{ status: 200 | 202; job: HierarchyJob }> {
  const source = await getJob(deps, jobId);
  const restoreId = `${jobId}-undo`;
  const existing = await deps.store.get(source.instanceId, restoreId);
  if (existing) {
    return { status: 200, job: existing };
  }
  await checkUndo(deps.cht, deps.session, deps.store, deps.settings.archiveDir, source);
  const now = new Date().toISOString();
  const job = await deps.store.save({
    id: restoreId,
    kind: 'restore',
    instanceId: source.instanceId,
    createdBy: deps.session.username,
    request: {
      kind: 'restore',
      sourceJobId: source.id,
      contactType: source.request.contactType,
      placeId: source.branch.placeId,
      recreateLogins: options.recreateLogins
    },
    branch: source.branch,
    status: 'queued',
    token: await jobToken(deps),
    attempts: 0,
    createdAt: now,
    updatedAt: now
  });
  await deps.store.save({ ...source, undoneBy: job.id });
  return { status: 202, job };
}

export async function undoPreview(deps: JobDeps, jobId: string): Promise<UndoPreview> {
  return previewUndo(deps.cht, deps.session, deps.store, deps.settings.archiveDir, await getJob(deps, jobId));
}

export function jobArchive(settings: JobSettings, job: HierarchyJob): string {
  const path = archivePath(settings.archiveDir, job);
  // deletes and merges keep a copy of what they change
  if ((job.kind !== 'delete' && job.kind !== 'merge') || !existsSync(path)) {
    throw new ApiError(404, 'ARCHIVE_NOT_FOUND', "This job has no archive, or it's no longer kept.");
  }
  return path;
}

// A job that succeeded, gone with everything it left: its record and log, its archive of deleted or
// merged docs, any work folder, and the undo of a delete. False, and nothing removed, while it or its
// undo is still to run, running, or failed, and so still to be finished or retried (APP.md → Data storage)
export async function forgetJob(deps: Pick<JobDeps, 'store' | 'settings'>, instanceId: string, jobId: string): Promise<boolean> {
  const job = await deps.store.get(instanceId, jobId);
  if (!job) return true;
  if (job.status !== 'done') return false;
  if (job.kind === 'delete' && !(await forgetJob(deps, instanceId, `${job.id}-undo`))) return false;

  await rm(archivePath(deps.settings.archiveDir, job), { force: true });
  await rm(within(deps.settings.workDir, job.id), { recursive: true, force: true });
  await deps.store.remove(instanceId, job.id, job.createdBy);
  return true;
}
