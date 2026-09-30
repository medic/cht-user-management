import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

import type { Session } from '../auth/session';
import type { Cht, CouchDoc } from '../cht/client';
import { ApiError } from '../errors';
import { recordCredentials } from '../places/credentials';
import { createUserWithRetries, ensureUserHasPlaces, personCheck } from '../places/documents';
import { generatePassword } from '../username';
import type { UploadLog } from '../upload-log';
import { authSessionValue, type ChtConfRunner } from './cht-conf';
import { archivePath, assertNoOverlappingJob, readArchive } from './delete';
import type { HierarchyJob, JobStore } from './jobs';

// Undoing a delete (APP.md → Deleting places → Undoing a delete): the archived docs are written back
// with cht-conf's upload-docs, as a job of its own. Accounts that only lost places get them back;
// disabled accounts get a new login only when the user asks for it, since CHT deleted their old one,
// password and all.

export const undoBody = z.object({ recreateLogins: z.boolean().default(false) }).strict();

export type UndoAccount = {
	username: string;
	places: string[];
	// its login was deleted with the places, so it can only come back as a new login
	disabled: boolean;
};

export type UndoPreview = {
	placeName: string;
	counts: { contacts: number; reports: number };
	parent: { id: string; name: string } | null;
	accounts: UndoAccount[];
	archiveExpiresAt: string;
};

// The accounts a delete affected: recorded by the job before anything changed, or, for jobs that ran
// before that was recorded, the ones cht-conf named in its log
async function affectedAccounts(
	cht: Cht,
	store: JobStore,
	job: HierarchyJob,
	placeIds: string[]
): Promise<{ username: string; contactId?: string; placeIds: string[]; disabled: boolean }[]> {
	if (job.accounts) return job.accounts;
	const line = (await store.log(job.instanceId, job.id)).find((l) => /will update \d+ user accounts: /.test(l));
	const usernames = line?.match(/user accounts: (.+?) and cannot be undone/)?.[1].split(', ').filter(Boolean) ?? [];
	const settings = usernames.length ? await cht.getDocs(usernames.map((u) => `org.couchdb.user:${u}`)) : [];
	return settings.map((doc) => {
		const facilities = [doc.facility_id].flat().filter(Boolean) as string[];
		return { username: String(doc.name), contactId: doc.contact_id as string | undefined, placeIds: facilities.filter((id) => placeIds.includes(id)), disabled: doc.inactive === true };
	});
}

async function archived(archiveDir: string, job: HierarchyJob): Promise<CouchDoc[]> {
	const docs: CouchDoc[] = [];
	for await (const doc of readArchive(archivePath(archiveDir, job))) docs.push(doc);
	return docs;
}

const isReport = (doc: CouchDoc) => doc.type === 'data_record';

// Checks before an undo is scheduled
export async function checkUndo(
	cht: Cht,
	session: Session,
	store: JobStore,
	archiveDir: string,
	job: HierarchyJob
): Promise<{ docs: CouchDoc[]; parent: CouchDoc | null }> {
	if (job.kind !== 'delete' || job.status !== 'done') {
		throw new ApiError(409, 'NOT_UNDOABLE', 'Only a finished delete can be undone.');
	}
	if (!job.archive?.available || !existsSync(archivePath(archiveDir, job)) || Date.parse(job.archive.expiresAt) < Date.now()) {
		throw new ApiError(409, 'ARCHIVE_NOT_FOUND', "This delete's archive is no longer kept, so it can't be undone.");
	}
	const docs = await archived(archiveDir, job);

	// the place goes back where it was, so the place above it must still be there
	const parentId = job.branch.lineage[0];
	const parent = parentId ? await cht.getDoc(parentId) : null;
	if (parentId && !parent) {
		throw new ApiError(409, 'PARENT_GONE', `The place ${job.branch.placeName} was under has since been deleted too. Undo that first.`);
	}
	// nothing may have taken the ids since
	const taken = await cht.getDocs(docs.map((doc) => doc._id));
	if (taken.length) {
		throw new ApiError(409, 'UNDO_CONFLICT', `${taken.length} of the deleted docs' ids are in use again, so they can't be restored.`, {
			ids: taken.slice(0, 10).map((doc) => doc._id)
		});
	}
	const place = docs.find((doc) => doc._id === job.branch.placeId) ?? { _id: job.branch.placeId, name: job.branch.placeName };
	await assertNoOverlappingJob(store, session.instanceId, place);
	return { docs, parent };
}

export async function previewUndo(cht: Cht, session: Session, store: JobStore, archiveDir: string, job: HierarchyJob): Promise<UndoPreview> {
	const { docs, parent } = await checkUndo(cht, session, store, archiveDir, job);
	const isPerson = await personCheck(cht);
	const places = docs.filter((doc) => !isReport(doc) && !isPerson(doc));
	const names = new Map(places.map((doc) => [doc._id, String(doc.name ?? doc._id)]));
	const accounts = await affectedAccounts(cht, store, job, places.map((doc) => doc._id));
	return {
		placeName: job.branch.placeName,
		counts: { contacts: docs.filter((doc) => !isReport(doc)).length, reports: docs.filter(isReport).length },
		parent: parent ? { id: parent._id, name: String(parent.name ?? parent._id) } : null,
		accounts: accounts.map((account) => ({ username: account.username, places: account.placeIds.map((id) => names.get(id) ?? id), disabled: account.disabled })),
		archiveExpiresAt: job.archive!.expiresAt
	};
}

// ---- running the job

export type RestoreRun = {
	job: HierarchyJob;
	source: HierarchyJob;
	cht: Cht;
	store: JobStore;
	uploadLog: UploadLog;
	instanceUrl: string;
	sessionCookie: string;
	runChtConf: ChtConfRunner;
	workDir: string;
	archiveDir: string;
	log: (line: string) => void;
	update: (change: Partial<HierarchyJob>) => Promise<HierarchyJob>;
};

export async function runRestore(run: RestoreRun): Promise<HierarchyJob> {
	const { job, source, cht } = run;
	const started = Date.now();
	const docs = await archived(run.archiveDir, source);
	const isPerson = await personCheck(cht);
	const places = docs.filter((doc) => !isReport(doc) && !isPerson(doc));
	const workDir = join(run.workDir, job.id);
	const folder = join(workDir, 'json_docs');

	try {
		// 1. the archived docs, back as they were: written by cht-conf's upload-docs. Without their old
		// revision, since the deletion is the doc's latest one. Once written, a re-run skips this.
		if (job.phase !== 'uploaded') {
			const missing = new Set((await cht.getDocs(docs.map((doc) => doc._id))).map((doc) => doc._id));
			const toWrite = docs.filter((doc) => !missing.has(doc._id));
			await rm(workDir, { recursive: true, force: true });
			await mkdir(folder, { recursive: true });
			for (const { _rev: _unused, _deleted: _gone, ...doc } of toWrite) {
				await writeFile(join(folder, `${doc._id}.doc.json`), JSON.stringify(doc));
			}
			run.log(`Restoring ${toWrite.length} docs from the archive of ${source.branch.placeName}…`);
			await run.update({ progress: { written: 0, total: docs.length } });
			await run.runChtConf({
				action: 'upload-docs',
				args: [`--docDirectoryPath=${folder}`],
				workDir,
				instanceUrl: run.instanceUrl,
				sessionToken: authSessionValue(run.sessionCookie),
				onLine: (line) => {
					run.log(line);
					const progress = line.match(/(\d+)\/(\d+) docs/);
					if (progress) void run.update({ progress: { written: docs.length - toWrite.length + Number(progress[1]), total: docs.length } });
				}
			});
			if (!(await cht.getDoc(source.branch.placeId))) {
				throw new ApiError(502, 'NOT_RESTORED', `${source.branch.placeName} still doesn't exist after the upload`);
			}
			await run.update({ phase: 'uploaded', progress: { written: docs.length, total: docs.length } });
		}

		// 2. the accounts
		const accounts = await affectedAccounts(cht, run.store, source, places.map((doc) => doc._id));
		let accountsRestored = 0;
		const loginsRecreated: { username: string; previousUsername: string }[] = [...(job.result?.loginsRecreated ?? [])];
		const settings = new Map((await cht.getDocs(accounts.map((a) => `org.couchdb.user:${a.username}`))).map((doc) => [String(doc.name), doc]));
		for (const account of accounts) {
			const doc: Record<string, any> = settings.get(account.username) ?? {};
			const contactId = String(account.contactId ?? doc.contact_id ?? '');
			if (!contactId || !account.placeIds.length) continue;
			const active = (await cht.usersByContact(contactId)).find((user) => user.username === account.username && !user.inactive);
			if (active) {
				// still has a login: it only lost the places, so it gets them back
				if (await ensureUserHasPlaces(cht, active, account.placeIds)) accountsRestored++;
				continue;
			}
			// what CHT kept of the account: its settings, marked inactive
			if (!job.request.recreateLogins || !doc.name || loginsRecreated.some((l) => l.previousUsername === account.username)) continue;
			// a new login, as CHT deleted the old one: the same roles, places and person, a new password
			const { username, password } = await createUserWithRetries(
				cht,
				{
					username: account.username,
					password: generatePassword(),
					roles: [doc.roles ?? []].flat() as string[],
					place: account.placeIds,
					contact: contactId,
					fullname: String(doc.fullname ?? ''),
					phone: String(doc.phone ?? ''),
					password_change_required: false
				},
				generatePassword
			);
			loginsRecreated.push({ username, previousUsername: account.username });
			run.log(username === account.username ? `Recreated the login ${username}.` : `Recreated the login of ${account.username} as ${username}.`);
			const place = places.find((p) => p._id === account.placeIds[0]);
			await recordCredentials(run.uploadLog, job.createdBy, {
				place: String(place?.name ?? ''),
				person: String(doc.fullname ?? ''),
				phone: String(doc.phone ?? ''),
				contactType: String(place?.contact_type ?? place?.type ?? ''),
				credentials: { username, password, placeId: account.placeIds[0], contactId, created_at: Date.now() },
				hierarchy: {}
			});
			await run.update({ result: { contacts: 0, reports: 0, durationMs: 0, ...job.result, loginsRecreated } });
		}

		run.log(`Restored ${docs.filter((doc) => !isReport(doc)).length} contacts and ${docs.filter(isReport).length} reports.`);
		return run.update({
			status: 'done',
			finishedAt: new Date().toISOString(),
			result: {
				contacts: docs.filter((doc) => !isReport(doc)).length,
				reports: docs.filter(isReport).length,
				accountsRestored,
				loginsRecreated,
				durationMs: Date.now() - started
			}
		});
	} finally {
		await rm(workDir, { recursive: true, force: true });
	}
}
