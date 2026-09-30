import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import type { CouchDoc } from '../cht/client';
import { getContactType } from '../config';
import { ApiError } from '../errors';
import type { OperationContext } from '../places/context';
import { prepareCreate, type PreparedCreate } from '../places/create';
import { runBatch, type BatchItemResult } from '../places/batch';
import { buildProperties, type PropertyInput } from '../../validation';
import { createRequest, docId, type BatchRequest, type CreateRequest, type ReplaceRequest } from '../places/schemas';
import { parseReplaceItem, stageReplace } from './replace-items';
import { parseDeleteItem, stageDelete } from './delete-items';
import { parseMoveItem, stageMove } from './move-items';
import { parseMergeItem, stageMerge } from './merge-items';
import { scheduleJob, view, type JobDeps } from '../hierarchy/service';
import { toErrorBody } from '../http';
import type { StagedStore } from './store';
import { STAGED_KINDS, STAGED_STATUSES, type ListOwner, type StagedItem, type StagedStatus } from './types';
import { LOCK_MS, type UploadState, type UploadTracker } from './upload-tracker';
import { runValidation } from './csv';
import { NOT_UPLOADED, UPLOADED_EARLIER, uploadGroup } from '../../staged';
import { ownerOf } from './owner';

export { uploadGroup };
import { describeMatch, personKey, stagedPeople } from './people';

export { ownerOf };

export type StagedDeps = {
	store: StagedStore;
	tracker: UploadTracker;
	validationTracker: UploadTracker;
	context: OperationContext;
	maxBatch: number;
	// for delete items: uploading one schedules a hierarchy job
	jobs?: Omit<JobDeps, 'cht' | 'session'>;
};

export const createItemRequest = createRequest.extend({ placeId: docId });
type CreateItemRequest = z.infer<typeof createItemRequest>;

export const addItemBody = z
	.object({
		kind: z.enum(STAGED_KINDS),
		request: z.record(z.string(), z.unknown()),
		confirmName: z.string().optional(),
		// the person looks like one already staged, and the user said it's someone else
		newPerson: z.boolean().optional()
	})
	.strict();

export const samePersonQuery = z
	.object({
		contactType: z.string().min(1),
		contact: z.object({ id: z.string().optional(), properties: z.record(z.string(), z.union([z.string(), z.array(z.string())])) }).strict(),
		user: z.object({ roles: z.array(z.string()) }).strict().optional()
	})
	.strict();

export const editItemBody = z.object({ revision: z.number().int().positive(), request: z.record(z.string(), z.unknown()) }).strict();
export const confirmItemBody = z.object({ revision: z.number().int().positive(), confirmName: z.string().optional() }).strict();
export const confirmManyBody = z.object({ ids: z.array(z.string().min(1)).min(1) }).strict();
export const uploadBody = z.object({ ids: z.array(z.string().min(1)).min(1).optional() }).strict();

export const listQuery = z.object({
	status: z.enum(STAGED_STATUSES).optional(),
	kind: z.enum(STAGED_KINDS).optional(),
	q: z.string().optional(),
	// only the rows of one CSV file
	file: z.string().optional(),
	limit: z.coerce.number().int().min(1).max(500).default(50),
	cursor: z.string().optional()
});

const LOCKED: StagedStatus[] = ['uploading', 'created'];


// ---- listing

export async function listItems(deps: StagedDeps, query: z.infer<typeof listQuery>) {
	const owner = ownerOf(deps.context);
	await recoverInterruptedUpload(deps, owner);

	const text = query.q?.trim().toLowerCase();
	const matching = (await deps.store.list(owner))
		.filter((item) => !query.status || item.status === query.status)
		.filter((item) => !query.kind || item.kind === query.kind)
		.filter((item) => !query.file || (item.source.type === 'csv' && item.source.file === query.file))
		.filter((item) => !text || [item.summary.title, item.summary.subtitle, item.summary.person].some((v) => v?.toLowerCase().includes(text)))
		.sort(listOrder);

	const offset = query.cursor ? Number(Buffer.from(query.cursor, 'base64url').toString()) || 0 : 0;
	const page = matching.slice(offset, offset + query.limit);
	const nextOffset = offset + page.length;

	const [counts, upload, validation] = await Promise.all([
		deps.store.counts(owner),
		deps.tracker.state(owner),
		deps.validationTracker.state(owner)
	]);
	// a validation run that stopped with its server leaves items pending; start another
	if (validation.state === 'idle' && ((counts.pending ?? 0) > 0 || (counts.validating ?? 0) > 0)) {
		void runValidation(deps);
	}
	return {
		items: await withJobs(deps, page),
		nextCursor: nextOffset < matching.length ? Buffer.from(String(nextOffset)).toString('base64url') : undefined,
		total: matching.length,
		counts,
		upload,
		validation
	};
}

// An upload whose server stopped leaves items "uploading" with no lock held; nothing will finish them
async function recoverInterruptedUpload(deps: StagedDeps, owner: ListOwner): Promise<void> {
	const counts = await deps.store.counts(owner);
	if (!counts.uploading || (await deps.tracker.state(owner)).state === 'running') {
		return;
	}
	for (const item of await deps.store.list(owner)) {
		if (item.status === 'uploading') {
			await saveIgnoringConflict(deps, owner, item, {
				status: 'failed',
				failure: { code: 'UPLOAD_INTERRUPTED', message: 'The upload stopped before this item finished. Retrying is safe.' }
			});
		}
	}
}

// Items not uploaded come first, then each upload's items, the latest upload first (the list's
// timeline); within each, newestFirst. Failed items count as not uploaded.
function listOrder(a: StagedItem, b: StagedItem): number {
	const [ga, gb] = [uploadGroup(a), uploadGroup(b)];
	if (ga !== gb) {
		// not uploaded first, then later uploads first; "earlier" (no record of which) last
		if (ga === NOT_UPLOADED || gb === UPLOADED_EARLIER) return -1;
		if (gb === NOT_UPLOADED || ga === UPLOADED_EARLIER) return 1;
		return ga < gb ? 1 : -1;
	}
	return newestFirst(a, b);
}

// The most recently added first. The rows of one CSV file were added together, so they stay
// together in file order. Uploads still go in the order items were added (by sequence).
function newestFirst(a: StagedItem, b: StagedItem): number {
	const sameUpload = a.source.type === 'csv' && b.source.type === 'csv' && a.source.file === b.source.file && a.createdAt === b.createdAt;
	if (sameUpload) {
		return a.sequence - b.sequence;
	}
	return b.createdAt.localeCompare(a.createdAt) || b.sequence - a.sequence || a.id.localeCompare(b.id);
}

// ---- adding and editing

export async function getItem(deps: StagedDeps, id: string): Promise<StagedItem> {
	return requireItem(deps, ownerOf(deps.context), id);
}

// Increasing within a process even for items added in the same millisecond; across server
// instances, millisecond timestamps keep it close to the real order
let lastSequence = 0;
function nextSequence(): number {
	lastSequence = Math.max(Date.now() * 1000, lastSequence + 1);
	return lastSequence;
}

export async function addItem(deps: StagedDeps, body: z.infer<typeof addItemBody>): Promise<StagedItem> {
	if (typeof body.request.contactType === 'string') {
		getContactType(body.request.contactType, body.kind);
	}
	if (body.kind === 'replace') {
		return addReplaceItem(deps, body.request);
	}
	if (body.kind === 'delete') {
		return addDeleteItem(deps, body.request);
	}
	if (body.kind === 'move') {
		return addMoveItem(deps, body.request);
	}
	if (body.kind === 'merge') {
		return addMergeItem(deps, body.request);
	}
	const request = parseCreateItem(body.kind, body.request);
	const owner = ownerOf(deps.context);

	const all = await deps.store.list(owner);
	const alreadyStaged = all.find((item) => item.request.placeId === request.placeId);
	if (alreadyStaged) {
		throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', `place "${request.placeId}" is already in the staged list`, { itemId: alreadyStaged.id });
	}

	const personItem = findPersonItem(all, request);
	if (!personItem && request.contact.properties && !body.newPerson) {
		const same = samePersonIn(all, request.contactType, request.contact.properties, request.user?.roles, request.contact.id);
		if (same) {
			throw new ApiError(409, 'SAME_PERSON_STAGED', `${same.summary.person ?? 'This person'} is already in the staged list, for "${same.summary.title}". Share their person, or say this is someone else.`, describeMatch(same));
		}
	}
	const prepared = await prepareStaged(deps, request, personItem);
	const now = new Date().toISOString();
	return deps.store.put(
		owner,
		{
			id: randomUUID(),
			kind: 'create',
			request,
			source: { type: 'form' },
			status: 'ready',
			...(personItem ? { dependsOn: personItem.id } : {}),
			summary: summarize(prepared),
			revision: 0,
			sequence: nextSequence(),
			createdAt: now,
			updatedAt: now
		},
		null
	);
}

// ---- delete items (APP.md → Deleting places)

// From the form, where the name was typed to confirm, so it's ready
async function addDeleteItem(deps: StagedDeps, body: unknown): Promise<StagedItem> {
	const request = parseDeleteItem(body);
	const owner = ownerOf(deps.context);
	const all = await deps.store.list(owner);
	if (all.some((item) => item.request.jobId === request.jobId)) {
		throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', `job "${request.jobId}" is already in the staged list`);
	}
	const { summary, claims } = await stageDelete(deps, request, all, { requireConfirmation: true });
	const now = new Date().toISOString();
	return deps.store.put(
		owner,
		{
			id: randomUUID(),
			kind: 'delete',
			request,
			source: { type: 'form' },
			status: 'ready',
			summary,
			claims,
			revision: 0,
			sequence: nextSequence(),
			createdAt: now,
			updatedAt: now
		},
		null
	);
}

// From the form, where a large move was confirmed with a tick, so it's ready
async function addMoveItem(deps: StagedDeps, body: unknown): Promise<StagedItem> {
	const request = parseMoveItem(body);
	const owner = ownerOf(deps.context);
	const all = await deps.store.list(owner);
	if (all.some((item) => item.request.jobId === request.jobId)) {
		throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', `job "${request.jobId}" is already in the staged list`);
	}
	const { summary, claims, targets } = await stageMove(deps, request, all, { requireLargeAccepted: true });
	const now = new Date().toISOString();
	return deps.store.put(
		owner,
		{
			id: randomUUID(),
			kind: 'move',
			request,
			source: { type: 'form' },
			status: 'ready',
			summary,
			claims,
			targets,
			revision: 0,
			sequence: nextSequence(),
			createdAt: now,
			updatedAt: now
		},
		null
	);
}

// From the form, where the source's name was typed to confirm, so it's ready
async function addMergeItem(deps: StagedDeps, body: unknown): Promise<StagedItem> {
	const request = parseMergeItem(body);
	const owner = ownerOf(deps.context);
	const all = await deps.store.list(owner);
	if (all.some((item) => item.request.jobId === request.jobId)) {
		throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', `job "${request.jobId}" is already in the staged list`);
	}
	const { summary, claims, targets } = await stageMerge(deps, request, all, { requireConfirmation: true });
	const now = new Date().toISOString();
	return deps.store.put(
		owner,
		{
			id: randomUUID(),
			kind: 'merge',
			request,
			source: { type: 'form' },
			status: 'ready',
			summary,
			claims,
			targets,
			revision: 0,
			sequence: nextSequence(),
			createdAt: now,
			updatedAt: now
		},
		null
	);
}

// The job each uploaded delete, move or merge item scheduled, as it stands now
async function withJobs(deps: StagedDeps, items: StagedItem[]): Promise<StagedItem[]> {
	if (!deps.jobs) return items;
	const jobs = deps.jobs;
	return Promise.all(
		items.map(async (item) => {
			const jobId = ['delete', 'move', 'merge'].includes(item.kind) && item.status === 'created' ? item.request.jobId : undefined;
			const job = jobId ? await jobs.store.get(deps.context.session.instanceId, jobId) : undefined;
			return job ? { ...item, job: await view(jobs.store, job) } : item;
		})
	);
}

// Uploading a delete schedules its job: the same jobId, so a retry returns the job already scheduled
// Uploading a delete or a move schedules its job: the same jobId, so a retry returns the job already
// scheduled. In the order they were added, one after another.
async function scheduleJobs(deps: StagedDeps, owner: ListOwner, items: StagedItem[]): Promise<void> {
	for (const item of items) {
		try {
			if (!deps.jobs) throw new Error('staged list has no job store');
			const jobDeps = { ...deps.jobs, cht: deps.context.cht, session: deps.context.session };
			let scheduled: Awaited<ReturnType<typeof scheduleJob>>;
			let placeId: string;
			if (item.kind === 'move') {
				const { jobId, acceptLarge: _accepted, ...request } = parseMoveItem(item.request);
				placeId = request.placeId;
				scheduled = await scheduleJob(jobDeps, jobId, { kind: 'move', ...request });
			} else if (item.kind === 'merge') {
				const { jobId, ...request } = parseMergeItem(item.request);
				placeId = request.sourceId;
				scheduled = await scheduleJob(jobDeps, jobId, { kind: 'merge', ...request });
			} else {
				const { jobId, ...request } = parseDeleteItem(item.request);
				placeId = request.placeId;
				scheduled = await scheduleJob(jobDeps, jobId, { kind: 'delete', ...request });
			}
			const { status, job } = scheduled;
			const request = { placeId };
			await recordResult(deps, owner, item.id, { placeId: request.placeId, status, body: { jobId: job.id, status: job.status } });
		} catch (e) {
			const { status, body } = toErrorBody(e);
			await recordResult(deps, owner, item.id, { placeId: item.request.placeId, status, body });
		}
		await deps.tracker.step(owner);
	}
}

// ---- replace items (APP.md → Replace Existing Users)

async function addReplaceItem(deps: StagedDeps, body: unknown): Promise<StagedItem> {
	const request = parseReplaceItem(body);
	const owner = ownerOf(deps.context);
	const all = await deps.store.list(owner);
	const { summary, claims } = await stageReplace(deps.context, request, all);
	const now = new Date().toISOString();
	return deps.store.put(
		owner,
		{
			id: randomUUID(),
			kind: 'replace',
			request,
			source: { type: 'form' },
			status: 'ready',
			summary,
			claims,
			revision: 0,
			sequence: nextSequence(),
			createdAt: now,
			updatedAt: now
		},
		null
	);
}

// The place and the incoming person (new or existing) may change only while the item has never been
// sent: after that, its ids are what a retry resumes with.
async function editReplaceItem(deps: StagedDeps, item: StagedItem, body: z.infer<typeof editItemBody>): Promise<StagedItem> {
	const owner = ownerOf(deps.context);
	const request = parseReplaceItem(body.request);
	// a CSV row whose place wasn't found has none yet, so fixing it means picking one
	const sent = !!item.upload || item.status === 'failed';
	if (sent && (request.placeId !== item.request.placeId || request.contact.id !== item.request.contact?.id)) {
		throw new ApiError(422, 'IDS_FIXED', "Once an item has been sent, its place and person can't change. Remove it and add a new one instead.");
	}
	const { summary, claims } = await stageReplace(deps.context, request, await deps.store.list(owner), item.id);
	return deps.store.put(
		owner,
		{ ...item, request, status: 'ready', summary, claims, errors: undefined, confirmation: undefined, failure: undefined },
		body.revision
	);
}

// ---- one person, many places (APP.md → One person, many places)

// The item creating this request's person, when another item in the list does: the one with the
// same contact.id that sends the person's properties. Later places for that person leave them out.
function findPersonItem(all: StagedItem[], request: CreateItemRequest, self?: string): StagedItem | undefined {
	const personItem = all.find(
		(item) => item.id !== self && item.kind === 'create' && item.request.contact?.id === request.contact.id && item.request.contact?.properties
	);
	if (!personItem) {
		return undefined;
	}
	const contactType = getContactType(request.contactType);
	if (personItem.request.contactType !== request.contactType || !contactType.can_assign_multiple) {
		throw new ApiError(409, 'CONTACT_ALREADY_ASSIGNED', `This person is already staged for "${personItem.summary.title}", and a ${contactType.friendly} can't share its person.`, {
			itemId: personItem.id
		});
	}
	if (request.contact.properties) {
		throw new ApiError(409, 'CONTACT_ALREADY_STAGED', `This person is created by the item for "${personItem.summary.title}". Leave out contact.properties for their other places.`, {
			itemId: personItem.id
		});
	}
	return personItem;
}

// POST /api/v1/checks/same-person: the staged person a form entry looks like, if any, for the form
// to ask whether they're the same (APP.md → One person, many places)
export async function findSamePerson(deps: StagedDeps, query: z.infer<typeof samePersonQuery>) {
	const same = samePersonIn(
		await deps.store.list(ownerOf(deps.context)),
		query.contactType,
		query.contact.properties,
		query.user?.roles,
		query.contact.id
	);
	return { match: same ? describeMatch(same) : null };
}

function samePersonIn(all: StagedItem[], typeName: string, properties: PropertyInput, roles: string[] | undefined, contactId?: string): StagedItem | undefined {
	const contactType = getContactType(typeName);
	if (!contactType.can_assign_multiple) {
		return undefined;
	}
	// person fields with errors are never matched, as for CSV rows
	const built = buildProperties({ contactType, mode: 'create', place: {}, contact: properties, lineage: {} });
	if (Object.keys(built.errors).some((path) => path.startsWith('contact.'))) {
		return undefined;
	}
	const key = personKey(contactType, properties, roles);
	const same = key ? stagedPeople(contactType, all).get(key) : undefined;
	return same && same.request.contact?.id !== contactId ? same : undefined;
}

// Items that add a place to the person another item creates
function dependantsOf(all: StagedItem[], item: StagedItem): StagedItem[] {
	return all.filter((other) => other.dependsOn === item.id);
}

export async function editItem(deps: StagedDeps, id: string, body: z.infer<typeof editItemBody>): Promise<StagedItem> {
	const owner = ownerOf(deps.context);
	const item = await requireItem(deps, owner, id);
	if (LOCKED.includes(item.status)) {
		throw itemLocked(item);
	}
	if (item.kind === 'replace') {
		return editReplaceItem(deps, item, body);
	}
	if (item.kind === 'delete' || item.kind === 'move' || item.kind === 'merge') {
		throw new ApiError(422, 'NOT_EDITABLE', `A ${item.kind} can’t be edited. Remove it, and add the ${item.kind} you want instead.`);
	}

	const request = parseCreateItem(item.kind, body.request);
	if (request.placeId !== item.request.placeId || request.contact.id !== item.request.contact?.id) {
		throw new ApiError(422, 'IDS_FIXED', "An item's place and person ids can't change. Remove it and add a new one instead.");
	}

	const all = await deps.store.list(owner);
	const personItem = findPersonItem(all, request, item.id);
	const dependants = dependantsOf(all, item).filter((other) => !LOCKED.includes(other.status));
	if (dependants.length && !request.contact.properties) {
		throw new ApiError(422, 'VALIDATION_FAILED', 'one or more properties are invalid', {
			'contact.properties': `Is Required: ${dependants.length} other ${dependants.length === 1 ? 'place uses' : 'places use'} this person`
		});
	}

	const prepared = await prepareStaged(deps, request, personItem);
	const saved = await deps.store.put(
		owner,
		{
			...item,
			request,
			status: 'ready',
			dependsOn: personItem?.id,
			summary: summarize(prepared),
			errors: undefined,
			confirmation: undefined,
			failure: undefined
		},
		body.revision
	);
	// the person's other places show their name too
	for (const dependant of dependants) {
		if (dependant.summary.person !== saved.summary.person) {
			await saveIgnoringConflict(deps, owner, dependant, { summary: { ...dependant.summary, person: saved.summary.person } });
		}
	}
	return saved;
}

function parseCreateItem(kind: string, request: unknown): CreateItemRequest {
	if (kind !== 'create') {
		throw new ApiError(422, 'NOT_YET_SUPPORTED', `"${kind}" items can't be staged yet; only "create" and "replace" are supported so far`);
	}
	const parsed = createItemRequest.safeParse(request);
	if (!parsed.success) {
		throw new ApiError(400, 'INVALID_REQUEST', 'request does not match the expected shape', {
			issues: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
		});
	}
	return parsed.data;
}

// The same checks the create itself makes, without writing (APP.md → Adding from the form)
// A later place for a person who is only staged so far is checked with that person's details, as it
// will be once their item has uploaded
async function prepareStaged(deps: StagedDeps, request: CreateItemRequest, personItem?: StagedItem): Promise<PreparedCreate> {
	const { placeId, ...createBody } = request;
	if (personItem) {
		createBody.contact = { ...createBody.contact, properties: personItem.request.contact?.properties };
	}
	const prepared = await prepareCreate(deps.context, placeId, createBody as CreateRequest);
	if (prepared.existingPlace) {
		throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', `place "${placeId}" already exists in CHT`);
	}
	return prepared;
}

function summarize(prepared: PreparedCreate): StagedItem['summary'] {
	return {
		title: prepared.built.place.name ?? 'Unnamed place',
		subtitle: locationOf(prepared.ancestors),
		person: String(prepared.existingContact?.name ?? prepared.built.contact.name ?? '') || undefined
	};
}

// "Kisumu › Kisumu West": every place above, top first, from the real ancestors rather than just
// the levels the config names
function locationOf(ancestors: (CouchDoc | null)[]): string | undefined {
	const names = ancestors
		.map((doc) => doc?.name)
		.filter((name): name is string => typeof name === 'string' && name.length > 0)
		.reverse();
	return names.length ? names.join(' › ') : undefined;
}

// ---- confirming and removing

export async function confirmItem(deps: StagedDeps, id: string, body: z.infer<typeof confirmItemBody>): Promise<StagedItem> {
	const owner = ownerOf(deps.context);
	const item = await requireItem(deps, owner, id);
	return deps.store.put(owner, confirmed(item, body.confirmName), body.revision);
}

export async function confirmMany(deps: StagedDeps, ids: string[]): Promise<{ confirmed: string[]; skipped: string[] }> {
	const owner = ownerOf(deps.context);
	const confirmedIds: string[] = [];
	const skipped: string[] = [];
	for (const id of ids) {
		const item = await deps.store.get(owner, id);
		// merges and deletes are confirmed one at a time, by typing the name
		if (!item || item.status !== 'needs_confirmation' || item.confirmation?.reason === 'typed_name') {
			skipped.push(id);
			continue;
		}
		await deps.store.put(owner, confirmed(item), item.revision);
		confirmedIds.push(id);
	}
	return { confirmed: confirmedIds, skipped };
}

function confirmed(item: StagedItem, confirmName?: string): StagedItem {
	if (item.status !== 'needs_confirmation' || !item.confirmation) {
		throw new ApiError(409, 'NOTHING_TO_CONFIRM', 'This item is not waiting for confirmation.');
	}

	const request = { ...item.request };
	switch (item.confirmation.reason) {
		case 'duplicates':
			request.ignoreWarnings = true;
			break;
		case 'typed_name':
			if (confirmName?.trim() !== item.confirmation.expected) {
				throw new ApiError(422, 'CONFIRMATION_REQUIRED', `Type "${item.confirmation.expected}" exactly to confirm.`, {
					expected: item.confirmation.expected
				});
			}
			// the job checks the name again when it's scheduled
			request.confirmName = confirmName.trim();
			break;
		case 'large_move':
			request.acceptLarge = true;
			break;
	}
	return { ...item, request, status: 'ready', confirmation: undefined };
}

export async function removeItem(deps: StagedDeps, id: string): Promise<void> {
	const owner = ownerOf(deps.context);
	const item = await requireItem(deps, owner, id);
	if (item.status === 'uploading') {
		throw itemLocked(item);
	}
	// once uploaded, the person is in CHT and their other places no longer need this item
	if (item.status !== 'created') {
		await handOverPerson(deps, owner, item);
	}
	await deps.store.remove(owner, id);
}

// The item creating a person is going: the earliest of the person's other places creates them
// instead, with the same contact.id and details, and the rest now wait for that one
async function handOverPerson(deps: StagedDeps, owner: ListOwner, item: StagedItem): Promise<void> {
	const waiting = dependantsOf(await deps.store.list(owner), item)
		.filter((other) => other.status !== 'created')
		.sort((a, b) => a.sequence - b.sequence);
	const [heir, ...rest] = waiting;
	if (!heir) {
		return;
	}
	const request = { ...heir.request, contact: { id: item.request.contact.id, properties: item.request.contact.properties } };
	const saved = await saveIgnoringConflict(deps, owner, heir, { request, dependsOn: undefined });
	if (!saved) {
		throw new ApiError(409, 'REVISION_MISMATCH', 'The person’s other places changed meanwhile. Try again.');
	}
	for (const other of rest) {
		await saveIgnoringConflict(deps, owner, other, { dependsOn: saved.id });
	}
}

export async function clearFinished(deps: StagedDeps): Promise<{ removed: number }> {
	const owner = ownerOf(deps.context);
	let removed = 0;
	for (const item of await deps.store.list(owner)) {
		if (item.status === 'created' && (await deps.store.remove(owner, item.id))) {
			removed++;
		}
	}
	return { removed };
}

// ---- uploading (APP.md → Uploading)

export async function startUpload(deps: StagedDeps, ids?: string[]): Promise<{ uploading: number }> {
	const owner = ownerOf(deps.context);
	await recoverInterruptedUpload(deps, owner);

	// every ready item, or the ones asked for, which may include failed items being retried
	const all = await deps.store.list(owner);
	const chosen = (
		ids
			? all.filter((item) => ids.includes(item.id) && (item.status === 'ready' || item.status === 'failed'))
			: all.filter((item) => item.status === 'ready')
	).sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));

	// a later place for a person waits until the item creating them uploads, in this run or an earlier one
	const selected: StagedItem[] = [];
	for (const item of chosen) {
		const personItem = item.dependsOn ? all.find((other) => other.id === item.dependsOn) : undefined;
		if (personItem && personItem.status !== 'created' && !chosen.includes(personItem)) {
			await saveIgnoringConflict(deps, owner, item, {
				status: 'ready',
				failure: { code: 'WAITING_FOR_PERSON', message: `Waiting for "${personItem.summary.title}", which creates ${personItem.summary.person ?? 'the person'}, to upload.` }
			});
		} else {
			selected.push(item);
		}
	}
	if (!selected.length) {
		return { uploading: 0 };
	}

	const runId = await deps.tracker.begin(owner, selected.length);
	if (!runId) {
		throw new ApiError(409, 'UPLOAD_RUNNING', 'An upload is already running for this list.');
	}

	// which upload each item went in, for the list's timeline
	const upload = { runId, startedAt: new Date().toISOString() };
	const uploading: StagedItem[] = [];
	for (const item of selected) {
		const saved = await saveIgnoringConflict(deps, owner, item, { status: 'uploading', failure: undefined, upload });
		if (saved) {
			uploading.push(saved);
		}
	}

	// runs after the response; progress is read back from the items and the tracker
	void runUpload(deps, owner, runId, uploading);
	return { uploading: uploading.length };
}

export async function runUpload(deps: StagedDeps, owner: ListOwner, runId: string, items: StagedItem[]): Promise<void> {
	const heartbeat = setInterval(() => void deps.tracker.heartbeat(owner, runId).catch(() => undefined), LOCK_MS / 3);
	try {
		const jobs = (item: StagedItem) => ['delete', 'move', 'merge'].includes(item.kind);
		await scheduleJobs(deps, owner, items.filter(jobs));
		const writes = items.filter((item) => !jobs(item));
		for (let start = 0; start < writes.length; start += deps.maxBatch) {
			const chunk = await withoutFailedPeople(deps, owner, writes.slice(start, start + deps.maxBatch));
			if (!chunk.length) {
				continue;
			}
			const request = {
				items: chunk.map(({ kind, request: { placeId, ...body } }) =>
					kind === 'replace'
						? { op: 'replace' as const, placeId, body: body as ReplaceRequest }
						: { op: 'create' as const, placeId, body: body as CreateRequest }
				)
			} satisfies BatchRequest;
			await runBatch(deps.context, request, deps.maxBatch, async (index, result) => {
				await recordResult(deps, owner, chunk[index].id, result);
				await deps.tracker.step(owner);
			});
		}
	} catch (e) {
		console.error('upload stopped', e);
	} finally {
		clearInterval(heartbeat);
		// anything the run didn't reach is left retryable rather than stuck
		for (const item of await deps.store.list(owner)) {
			if (items.some((i) => i.id === item.id) && item.status === 'uploading') {
				await saveIgnoringConflict(deps, owner, item, {
					status: 'failed',
					failure: { code: 'UPLOAD_INTERRUPTED', message: 'The upload stopped before this item finished. Retrying is safe.' }
				});
			}
		}
		await deps.tracker.end(owner, runId);
	}
}

// Items are uploaded in the order they were added, so an item creating a person is in the same
// chunk as their other places, where the batch orders them, or an earlier one. For an earlier one,
// its places go ahead only if it was created.
async function withoutFailedPeople(deps: StagedDeps, owner: ListOwner, chunk: StagedItem[]): Promise<StagedItem[]> {
	const kept: StagedItem[] = [];
	for (const item of chunk) {
		const personItem = item.dependsOn && !chunk.some((other) => other.id === item.dependsOn) ? await deps.store.get(owner, item.dependsOn) : undefined;
		if (personItem && personItem.status !== 'created') {
			await recordResult(deps, owner, item.id, {
				placeId: item.request.placeId,
				status: 424,
				body: { error: { code: 'DEPENDENCY_FAILED', message: 'person item failed', details: { reason: 'person' } } }
			});
			await deps.tracker.step(owner);
		} else {
			kept.push(item);
		}
	}
	return kept;
}

async function recordResult(deps: StagedDeps, owner: ListOwner, id: string, result: BatchItemResult): Promise<void> {
	const current = await deps.store.get(owner, id);
	if (!current) {
		return;
	}
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each error code's own details
	const error = (result.body as { error?: { code: string; message: string; details?: Record<string, any> } }).error;

	if (result.status < 300) {
		await saveIgnoringConflict(deps, owner, current, { status: 'created', result: result.body as Record<string, unknown>, failure: undefined });
	} else if (error?.code === 'WARNINGS') {
		await saveIgnoringConflict(deps, owner, current, {
			status: 'needs_confirmation',
			confirmation: { reason: 'duplicates', warnings: error.details?.warnings ?? [] }
		});
	} else if (error?.code === 'VALIDATION_FAILED') {
		// the list's validation and the server's disagree, which is a bug (APP.md → Uploading)
		console.error(`staged item ${id} passed staging but failed validation on upload`, error.details);
		await saveIgnoringConflict(deps, owner, current, { status: 'invalid', errors: error.details as Record<string, string> });
	} else if (error?.code === 'DEPENDENCY_FAILED') {
		const message =
			error.details?.reason === 'person' ? 'Waiting for the item that creates its person to upload.' : 'Waiting for its parent item to upload.';
		await saveIgnoringConflict(deps, owner, current, { status: 'ready', failure: { code: error.code, message } });
	} else {
		await saveIgnoringConflict(deps, owner, current, {
			status: 'failed',
			failure: { code: error?.code ?? 'UNKNOWN', message: error?.message ?? 'The upload failed.', details: error?.details }
		});
	}
}

// Writes a change based on the item as it is now, re-reading once if it changed underneath
async function saveIgnoringConflict(
	deps: StagedDeps,
	owner: ListOwner,
	item: StagedItem,
	change: Partial<StagedItem>
): Promise<StagedItem | undefined> {
	for (let attempt = 0; attempt < 2; attempt++) {
		const current = attempt === 0 ? item : await deps.store.get(owner, item.id);
		if (!current) {
			return undefined;
		}
		try {
			return await deps.store.put(owner, { ...current, ...change }, current.revision);
		} catch (e) {
			if (!(e instanceof ApiError && e.code === 'REVISION_MISMATCH')) {
				throw e;
			}
		}
	}
	return undefined;
}

async function requireItem(deps: StagedDeps, owner: ListOwner, id: string): Promise<StagedItem> {
	const item = await deps.store.get(owner, id);
	if (!item) {
		throw new ApiError(404, 'ITEM_NOT_FOUND', 'This item is no longer in your staged list.');
	}
	return item;
}

function itemLocked(item: StagedItem): ApiError {
	return new ApiError(409, 'ITEM_LOCKED', item.status === 'uploading' ? 'This item is being uploaded.' : 'This item has already been uploaded.');
}

// The places one upload created, for downloading their logins together: `upload` is its runId, or
// "earlier" for items uploaded before uploads were recorded on items
export async function placesCreatedBy(deps: StagedDeps, upload: string): Promise<{ placeIds: string[]; startedAt?: string }> {
	const created = (await deps.store.list(ownerOf(deps.context))).filter(
		(item) => item.status === 'created' && (upload === UPLOADED_EARLIER ? !item.upload : item.upload?.runId === upload)
	);
	return {
		placeIds: created.map((item) => String(item.result?.placeId ?? item.request.placeId)),
		startedAt: created.find((item) => item.upload)?.upload?.startedAt
	};
}

export type StagedList = Awaited<ReturnType<typeof listItems>>;
export type { UploadState };
