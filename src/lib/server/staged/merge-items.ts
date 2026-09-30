import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import type { ContactType, HierarchyConstraint } from '../../config-types';
import type { ValidationErrors } from '../../validation';
import { formatValue } from '../../validation/validators';
import type { CouchDoc } from '../cht/client';
import { getContactType } from '../config';
import { ApiError } from '../errors';
import type { JobStore } from '../hierarchy/jobs';
import { checkMerge, previewMerge } from '../hierarchy/merge';
import { lineageIds } from '../places/documents';
import { isWithinFacilities } from '../places/directory';
import { docId } from '../places/schemas';
import { normalize, placesOfType } from '../places/unique';
import { resolveHierarchy } from './csv';
import type { StagedDeps } from './service';
import type { ListOwner, StagedItem } from './types';

// Merge items in the staged list (APP.md → Merging and deleting in the UI and CSV). Uploading one
// schedules its job; from then on the item shows the job's status.

export const mergeItemRequest = z
	.object({
		jobId: docId,
		contactType: z.string().min(1),
		sourceId: docId,
		destinationId: docId,
		// the source's name, typed to confirm; a CSV row waits for it in needs_confirmation
		confirmName: z.string().default('')
	})
	.strict();
export type MergeItemRequest = z.infer<typeof mergeItemRequest>;

export function parseMergeItem(request: unknown): MergeItemRequest {
	const parsed = mergeItemRequest.safeParse(request);
	if (!parsed.success) {
		throw new ApiError(400, 'INVALID_REQUEST', 'request does not match the expected shape', {
			issues: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
		});
	}
	return parsed.data;
}

function jobStore(deps: StagedDeps): JobStore {
	if (!deps.jobs) throw new Error('staged list has no job store');
	return deps.jobs.store;
}

// waiting hierarchy items, which can't overlap one another
export const waitingJobItem = (item: StagedItem) => ['move', 'merge', 'delete'].includes(item.kind) && item.status !== 'created';

// The merge's own checks, then the list's: the same place twice, a place both merged and deleted, a
// merge into a place that is itself merged away, moved or deleted, or anything else under it.
// `claims`: the source and everything above it. `targets`: the destination and everything above it.
export async function stageMerge(
	deps: StagedDeps,
	request: MergeItemRequest,
	all: StagedItem[],
	options: { requireConfirmation: boolean; self?: string }
): Promise<{ summary: StagedItem['summary']; claims: string[]; targets: string[]; source: CouchDoc }> {
	const { cht, session } = deps.context;
	const { source, destination } = await checkMerge(cht, session, jobStore(deps), request, { jobId: request.jobId, requireConfirmation: options.requireConfirmation });
	const claims = [source._id, ...lineageIds(source)];
	const targets = [destination._id, ...lineageIds(destination)];

	for (const other of all.filter((item) => item.id !== options.self && waitingJobItem(item) && item.claims)) {
		const theirs = other.claims![0];
		if (theirs === source._id || targets.includes(theirs) || (other.targets ?? []).includes(source._id)) {
			throw new ApiError(409, 'MERGE_ALREADY_STAGED', `This overlaps "${other.summary.title}", already waiting in your staged list. Remove or change one of them.`, {
				itemId: other.id
			});
		}
	}

	const preview = await previewMerge(cht, session, jobStore(deps), request);
	const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
	return {
		source,
		claims,
		targets,
		summary: {
			title: preview.source.name,
			subtitle: preview.source.location.split(' › ').slice(0, -1).join(' › ') || undefined,
			person: `Merges into ${preview.destination.name}, with ${plural(preview.counts.places, 'place')} and ${plural(preview.counts.people, 'person', 'people')}`,
			target: { placeId: preview.destination.id, name: preview.destination.name }
		}
	};
}

// ---- from a CSV: the source where it is, then `Into ` + the same for the destination

type Column = { header: string; required: boolean; level?: HierarchyConstraint };
export const INTO_PREFIX = 'Into ';

export function mergeColumns(contactType: ContactType): Column[] {
	const levels = [...contactType.hierarchy].sort((a, b) => b.level - a.level);
	return [
		...levels.map((level) => ({ header: level.friendly_name, required: level.required, level })),
		{ header: contactType.friendly, required: true },
		...levels.map((level) => ({ header: `${INTO_PREFIX}${level.friendly_name}`, required: level.required })),
		{ header: `${INTO_PREFIX}${contactType.friendly}`, required: true }
	];
}

export function stagedMergeRow(contactType: ContactType, row: Record<string, string>, source: { file: string; row: number; sequence: number; stagedAt: string }): StagedItem {
	const errors: ValidationErrors = {};
	for (const level of contactType.hierarchy) {
		if (level.required && !row[level.friendly_name]?.trim()) errors[`hierarchy.${level.property_name}`] = 'Is Required';
		if (level.required && !row[`${INTO_PREFIX}${level.friendly_name}`]?.trim()) errors[`into.${level.property_name}`] = 'Is Required';
	}
	const name = row[contactType.friendly]?.trim() ?? '';
	if (!name) errors.place = 'Is Required';
	if (!row[`${INTO_PREFIX}${contactType.friendly}`]?.trim()) errors.destination = 'Is Required';
	const invalid = Object.keys(errors).length > 0;
	return {
		id: randomUUID(),
		kind: 'merge',
		request: { jobId: randomUUID(), contactType: contactType.name, sourceId: '', destinationId: '', confirmName: '' },
		source: { type: 'csv', file: source.file, row: source.row },
		raw: row,
		status: invalid ? 'invalid' : 'pending',
		errors: invalid ? errors : undefined,
		summary: { title: name || `Row ${source.row}` },
		revision: 0,
		sequence: source.sequence,
		createdAt: source.stagedAt,
		updatedAt: source.stagedAt
	};
}

// Background checks for merge rows: both places found by name under their parents, then the merge's
// own checks. A row that passes waits for its source's name to be typed: never confirmed in bulk.
export async function validateMergeItems(
	deps: StagedDeps,
	owner: ListOwner,
	items: StagedItem[],
	save: (item: StagedItem, change: Partial<StagedItem>) => Promise<void>
): Promise<void> {
	if (!items.length) return;
	const { cht, session } = deps.context;
	const byType = new Map<string, Promise<CouchDoc[]>>();
	const places = (type: string) => {
		if (!byType.has(type)) byType.set(type, placesOfType(cht, type));
		return byType.get(type)!;
	};
	const list = await deps.store.list(owner);

	for (const item of items) {
		const contactType = getContactType(item.request.contactType);
		const raw = item.raw ?? {};
		const allowed = (doc: CouchDoc) => isWithinFacilities(session, doc);
		const find = async (prefix: string, errorKey: string, errors: ValidationErrors) => {
			const names = Object.fromEntries(contactType.hierarchy.map((l) => [l.property_name, raw[`${prefix}${l.friendly_name}`] ?? '']));
			const hierarchy = await resolveHierarchy(contactType, names, places, allowed);
			for (const [key, message] of Object.entries(hierarchy.errors)) errors[prefix ? key.replace(/^hierarchy\./, 'into.') : key] = message;
			const name = raw[`${prefix}${contactType.friendly}`]?.trim() ?? '';
			if (!hierarchy.parent || !name) return { id: '', path: hierarchy.path };
			const wanted = normalize(formatValue(contactType.replacement_property, name));
			const matches = (await places(contactType.name)).filter(
				(doc) => doc.parent?._id === hierarchy.parent!._id && normalize(formatValue(contactType.replacement_property, String(doc.name ?? ''))) === wanted
			);
			if (!matches.length) errors[errorKey] = `Can't find ${contactType.friendly} "${name}" under "${hierarchy.parent.name}"`;
			else if (matches.length > 1) errors[errorKey] = `Found ${matches.length} places called "${name}" under "${hierarchy.parent.name}"`;
			return { id: matches.length === 1 ? matches[0]._id : '', path: hierarchy.path };
		};
		const errors: ValidationErrors = { ...(item.errors ?? {}) };
		const from = await find('', 'place', errors);
		const into = await find(INTO_PREFIX, 'destination', errors);
		const request = { ...item.request, sourceId: from.id, destinationId: into.id };

		let change: Partial<StagedItem>;
		if (Object.keys(errors).length || !request.sourceId || !request.destinationId) {
			change = { status: 'invalid', errors, request, summary: { ...item.summary, subtitle: from.path || item.summary.subtitle } };
		} else {
			try {
				const parsed = parseMergeItem(request);
				const staged = await stageMerge(deps, parsed, list, { requireConfirmation: false, self: item.id });
				change = {
					status: 'needs_confirmation',
					confirmation: { reason: 'typed_name', expected: String(staged.source.name ?? '') },
					errors: undefined,
					request: parsed,
					summary: staged.summary,
					claims: staged.claims,
					targets: staged.targets
				};
			} catch (e) {
				if (!(e instanceof ApiError)) throw e;
				change = { status: 'invalid', errors: { place: e.message }, request, summary: { ...item.summary, subtitle: from.path || item.summary.subtitle } };
			}
		}
		const index = list.findIndex((other) => other.id === item.id);
		if (index >= 0) list[index] = { ...list[index], ...change };
		await save(item, change);
	}
}
