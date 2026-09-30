import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { within } from '../paths';
import { z } from 'zod';

import { assertAuthorized, type Session } from '../auth/session';
import type { Cht, CouchDoc } from '../cht/client';
import { getContactType } from '../config';
import { ApiError } from '../errors';
import { contactRef, docType, lineageIds, personCheck, retryOnConflict, TOOL } from '../places/documents';
import { docId } from '../places/schemas';
import { authSessionValue, type ChtConfRunner } from './cht-conf';
import { archive, assertNoOverlappingJob } from './delete';
import type { HierarchyJob, JobStore } from './jobs';
import { assertPrimaryContactsStay } from './move';

// APP.md → Merging places. cht-conf does the merge: `merge-contacts --merge-primary-contacts
// --disable-users` works out every change (everything under the source moves to the destination, the
// source and its primary contact are deleted, reports about them are reassigned), and `upload-docs`
// writes them. The app checks before scheduling, shows the impact, keeps a copy of every doc it
// changes, and records the merge on the destination.

export const mergeRequest = z
	.object({
		kind: z.literal('merge'),
		contactType: z.string().min(1),
		sourceId: docId,
		destinationId: docId,
		// the source's name, typed by the user: the source is deleted
		confirmName: z.string()
	})
	.strict();
export type MergeRequest = z.infer<typeof mergeRequest>;

const MAX_DEPTH = 20;
const LARGE = 100;

// Checks before scheduling (APP.md → Merging places → Checks before scheduling)
export async function checkMerge(
	cht: Cht,
	session: Session,
	jobs: JobStore,
	request: Omit<MergeRequest, 'kind' | 'confirmName'> & { confirmName?: string },
	options: { jobId?: string; requireConfirmation: boolean }
): Promise<{ source: CouchDoc; destination: CouchDoc; sourceAncestors: CouchDoc[]; destinationAncestors: CouchDoc[] }> {
	const contactType = getContactType(request.contactType, 'merge');
	// 1. both places
	const [source, destination] = await Promise.all([cht.getDoc(request.sourceId), cht.getDoc(request.destinationId)]);
	for (const [label, doc, id] of [['place', source, request.sourceId], ['destination', destination, request.destinationId]] as const) {
		if (!doc) throw new ApiError(404, 'PLACE_NOT_FOUND', `${label} "${id}" was not found`);
		if (docType(doc) !== contactType.name) {
			throw new ApiError(422, 'PLACE_WRONG_TYPE', `${label} "${id}" is a "${docType(doc)}", not a "${contactType.name}"`);
		}
		assertAuthorized(session, [doc._id, ...lineageIds(doc)]);
	}
	// 2. different places, and the destination isn't under the source
	if (source!._id === destination!._id || lineageIds(destination!).includes(source!._id)) {
		throw new ApiError(422, 'SAME_PLACE', `Can't merge ${source!.name} into ${destination!.name}`);
	}
	if (options.requireConfirmation && request.confirmName?.trim() !== String(source!.name ?? '')) {
		throw new ApiError(422, 'CONFIRMATION_REQUIRED', `Type "${source!.name}" exactly to confirm.`, { expected: source!.name });
	}
	// 3. primary contacts stay inside their place: the source's contents move under the destination
	const [sourceAncestors, destinationAncestors] = await Promise.all([cht.getDocs(lineageIds(source!)), cht.getDocs(lineageIds(destination!))]);
	await assertPrimaryContactsStay(cht, source!, sourceAncestors, new Set([destination!._id, ...lineageIds(destination!)]), 'merge');
	// 4. no other job on either branch
	await assertNoOverlappingJob(jobs, session.instanceId, source!, options.jobId);
	await assertNoOverlappingJob(jobs, session.instanceId, destination!, options.jobId);
	return { source: source!, destination: destination!, sourceAncestors, destinationAncestors };
}

export type MergePreview = {
	source: { id: string; name: string; location: string };
	destination: { id: string; name: string; location: string };
	// what moves from under the source to under the destination
	counts: { places: number; people: number };
	large: boolean;
	// the source's own properties, lost with it, next to the destination's
	properties: { name: string; label: string; source: string; destination: string }[];
	primaryContacts: { source: { id: string; name: string } | null; destination: { id: string; name: string } | null };
	accounts: { username: string; action: 'retire' | 'lose_place'; lastSync: string | null }[];
	lastSyncKnown: boolean;
	confirmName: string;
};

// What a merge will do (APP.md → Merging places → Showing the impact)
export async function previewMerge(cht: Cht, session: Session, jobs: JobStore, request: Omit<MergeRequest, 'kind' | 'confirmName'>): Promise<MergePreview> {
	const contactType = getContactType(request.contactType);
	const { source, destination, sourceAncestors, destinationAncestors } = await checkMerge(cht, session, jobs, request, { requireConfirmation: false });
	const under = (await cht.docsAtDepth(source._id, Array.from({ length: MAX_DEPTH }, (_, depth) => depth + 1))).filter(
		(doc) => doc._id !== contactRef(source.contact) || !contactRef(destination.contact)
	);
	const people = under.filter(await personCheck(cht));
	const primaries = await cht.getDocs([contactRef(source.contact), contactRef(destination.contact)].filter((id): id is string => !!id));
	const person = (id?: string) => {
		const doc = primaries.find((p) => p._id === id);
		return doc ? { id: doc._id, name: String(doc.name ?? doc._id) } : null;
	};
	const accounts = await cht.usersAtPlace(source._id);
	const syncs = session.isAdmin ? await cht.lastSyncs(accounts.map((a) => a.username)) : new Map<string, string | null>();
	const location = (doc: CouchDoc, ancestors: CouchDoc[]) => {
		const byId = new Map(ancestors.map((a) => [a._id, String(a.name ?? a._id)]));
		return [...lineageIds(doc).map((id) => byId.get(id) ?? id).reverse(), String(doc.name ?? '')].join(' › ');
	};
	return {
		source: { id: source._id, name: String(source.name ?? ''), location: location(source, sourceAncestors) },
		destination: { id: destination._id, name: String(destination.name ?? ''), location: location(destination, destinationAncestors) },
		counts: { places: under.length - people.length, people: people.length },
		large: under.length > LARGE,
		properties: contactType.place_properties
			.filter((p) => source[p.property_name] !== undefined || destination[p.property_name] !== undefined)
			.map((p) => ({ name: p.property_name, label: p.friendly_name, source: String(source[p.property_name] ?? ''), destination: String(destination[p.property_name] ?? '') })),
		primaryContacts: { source: person(contactRef(source.contact)), destination: person(contactRef(destination.contact)) },
		accounts: accounts.map((account) => ({
			username: account.username,
			action: account.placeIds.every((id) => id === source._id) ? 'retire' : 'lose_place',
			lastSync: syncs.get(account.username) ?? null
		})),
		lastSyncKnown: session.isAdmin,
		confirmName: String(source.name ?? '')
	};
}

// ---- running the job

export type MergeRun = {
	job: HierarchyJob;
	cht: Cht;
	instanceUrl: string;
	sessionCookie: string;
	runChtConf: ChtConfRunner;
	workDir: string;
	archiveDir: string;
	archiveTtlSeconds: number;
	log: (line: string) => void;
	update: (change: Partial<HierarchyJob>) => Promise<HierarchyJob>;
};

const STAGED = /\.doc\.json$/;

// APP.md → Merging places → Running the job
export async function runMerge(run: MergeRun): Promise<HierarchyJob> {
	const { job, cht } = run;
	const { sourceId, destinationId } = job.request as MergeRequest;
	const started = Date.now();
	const workDir = within(run.workDir, job.id);
	const docs = join(workDir, 'json_docs');
	const chtConf = (action: 'merge-contacts' | 'upload-docs', args: string[], onLine = run.log) =>
		run.runChtConf({ action, args, workDir, instanceUrl: run.instanceUrl, sessionToken: authSessionValue(run.sessionCookie), onLine });

	const source = await cht.getDoc(sourceId);
	if (!source) {
		// cht-conf can't work out a merge once the source is gone (APP.md → Deleting places → Known issues)
		if (job.phase === 'uploaded' || job.phase === 'archived') {
			run.log(`${job.branch.placeName} is already merged away.`);
			await recordMerge(run);
			return run.update({ status: 'done', finishedAt: new Date().toISOString(), result: job.result ?? { contacts: 0, reports: 0, durationMs: 0 } });
		}
		throw new ApiError(404, 'PLACE_NOT_FOUND', `${job.branch.placeName} no longer exists, so there's nothing for cht-conf to merge`);
	}

	try {
		await rm(workDir, { recursive: true, force: true });
		await mkdir(workDir, { recursive: true });

		// 1. cht-conf works out every change
		run.log(`Working out the merge of ${job.branch.placeName}…`);
		await chtConf('merge-contacts', [
			`--sources=${sourceId}`,
			`--destination=${destinationId}`,
			'--merge-primary-contacts',
			'--disable-users',
			`--docDirectoryPath=${docs}`
		]);
		const names = existsSync(docs) ? (await readdir(docs)).filter((name) => STAGED.test(name)) : [];
		const staged = await Promise.all(names.map(async (name) => JSON.parse(await readFile(join(docs, name), 'utf8')) as CouchDoc));
		const deleted = staged.filter((doc) => doc._deleted).length;
		const reports = staged.filter((doc) => doc.type === 'data_record').length;
		run.log(`cht-conf staged ${staged.length} docs: ${deleted} to delete, the rest updated.`);
		await run.update({ phase: 'staged', progress: { written: 0, total: staged.length } });

		// 2. a copy of every doc as it is now, before anything changes: the deleted source and its
		// primary contact, which nothing else keeps, and everything rewritten
		const kept = await archive(run, staged.map((doc) => doc._id));
		await run.update({
			phase: 'archived',
			archive: { available: true, docs: kept, expiresAt: new Date(Date.now() + run.archiveTtlSeconds * 1000).toISOString() }
		});

		// 3. cht-conf writes them, and handles the accounts at the source
		const users = { disabled: 0, updated: 0 };
		await chtConf('upload-docs', [`--docDirectoryPath=${docs}`], (line) => {
			run.log(line);
			const progress = line.match(/(\d+)\/(\d+) docs/);
			if (progress) void run.update({ progress: { written: Number(progress[1]), total: Number(progress[2]) } });
			const accounts = line.match(/(\d+) users disabled\. (\d+) users updated/);
			if (accounts) [users.disabled, users.updated] = [Number(accounts[1]), Number(accounts[2])];
		});
		await run.update({ phase: 'uploaded' });
		const failed = await uploadFailures(workDir);
		if (failed.length) {
			throw new ApiError(502, 'UPLOAD_INCOMPLETE', `cht-conf couldn't write ${failed.length} of ${staged.length} docs, eg. ${failed.slice(0, 3).join('; ')}`);
		}
		if (await cht.getDoc(sourceId)) {
			throw new ApiError(502, 'NOT_MERGED', `${job.branch.placeName} still exists after the upload`);
		}

		// 4. the merge, on record at the destination
		await recordMerge(run, source);
		run.log(`Merged ${job.branch.placeName} into ${(await cht.getDoc(destinationId))?.name ?? destinationId}.`);
		return run.update({
			status: 'done',
			finishedAt: new Date().toISOString(),
			progress: { written: staged.length, total: staged.length },
			result: { contacts: staged.length - reports, reports, usersDisabled: users.disabled, usersUpdated: users.updated, durationMs: Date.now() - started }
		});
	} finally {
		await rm(workDir, { recursive: true, force: true });
	}
}

// Appended to the destination's user_attribution.merges, once: what was merged into it, and whose
// primary contact
async function recordMerge(run: MergeRun, source?: CouchDoc): Promise<void> {
	const { job, cht } = run;
	const { sourceId, destinationId } = job.request as MergeRequest;
	await retryOnConflict(async () => {
		const destination = await cht.getDoc(destinationId);
		if (!destination) return;
		const attribution = destination.user_attribution ?? {};
		const merges: Record<string, unknown>[] = attribution.merges ?? [];
		if (merges.some((merge) => merge.source === sourceId)) return;
		attribution.merges = [
			...merges,
			{
				source: sourceId,
				sourceName: source?.name ?? job.branch.placeName,
				sourcePrimaryContact: source ? contactRef(source.contact) ?? null : null,
				tool: TOOL,
				username: job.createdBy,
				merged_time: Date.now()
			}
		];
		destination.user_attribution = attribution;
		await cht.putDoc(destination);
	});
}

async function uploadFailures(workDir: string): Promise<string[]> {
	const reports = (await readdir(workDir)).filter((name) => /^upload-docs\.\d+\.log\.json$/.test(name)).sort();
	if (!reports.length) return [];
	const report = JSON.parse(await readFile(join(workDir, reports.at(-1)!), 'utf8'));
	return Object.entries(report.failed ?? {}).map(([id, reason]) => `${id}: ${reason}`);
}
