import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import type { ContactType, HierarchyConstraint } from '../../config-types';
import type { ValidationErrors } from '../../validation';
import { formatValue } from '../../validation/validators';
import type { CouchDoc } from '../cht/client';
import { getContactType } from '../config';
import { ApiError } from '../errors';
import { checkDelete, previewDelete } from '../hierarchy/delete';
import type { JobStore } from '../hierarchy/jobs';
import { lineageIds } from '../places/documents';
import { isWithinFacilities } from '../places/directory';
import { docId } from '../places/schemas';
import { placeLookup } from '../places/lookup';
import { normalize } from '../places/unique';
import { resolveHierarchy } from './csv';
import type { StagedDeps } from './service';
import type { ListOwner, StagedItem } from './types';

// Delete items in the staged list (APP.md → Deleting places, and Merging and deleting in the UI and
// CSV). Uploading one schedules its job; from then on the item shows the job's status.

export const deleteItemRequest = z
	.object({
		// client-chosen: scheduling the same id again returns the job it already created
		jobId: docId,
		contactType: z.string().min(1),
		placeId: docId,
		// the place's name, typed to confirm; a CSV row waits for it in needs_confirmation
		confirmName: z.string().default('')
	})
	.strict();
export type DeleteItemRequest = z.infer<typeof deleteItemRequest>;

export function parseDeleteItem(request: unknown): DeleteItemRequest {
	const parsed = deleteItemRequest.safeParse(request);
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

// The delete's own checks, then the list's: two waiting deletes can't overlap, since the second would
// find its branch already gone or half gone. `claims`: the place, then every place above it.
export async function stageDelete(
	deps: StagedDeps,
	request: DeleteItemRequest,
	all: StagedItem[],
	options: { requireConfirmation: boolean; self?: string }
): Promise<{ summary: StagedItem['summary']; claims: string[]; placeDoc: CouchDoc }> {
	const { cht, session } = deps.context;
	const { placeDoc } = await checkDelete(cht, session, jobStore(deps), { ...request, kind: 'delete' }, { jobId: request.jobId, requireConfirmation: options.requireConfirmation });
	const claims = [placeDoc._id, ...lineageIds(placeDoc)];

	const clash = all.find(
		(item) =>
			item.id !== options.self &&
			['move', 'merge', 'delete'].includes(item.kind) &&
			item.status !== 'created' &&
			item.claims &&
			(claims.includes(item.claims[0]) ||
				(item.kind === 'delete' && item.claims.includes(placeDoc._id)) ||
				// the destination of a merge, or the new parent of a move, or anything above them
				(item.targets ?? []).includes(placeDoc._id))
	);
	if (clash) {
		throw new ApiError(409, 'DELETE_ALREADY_STAGED', `"${clash.summary.title}" overlaps a delete already waiting in your staged list. Remove one of them.`, {
			itemId: clash.id
		});
	}

	const preview = await previewDelete(cht, session, jobStore(deps), { ...request, kind: 'delete' });
	const { places, people, reports } = preview.counts;
	const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
	return {
		placeDoc,
		claims,
		summary: {
			title: preview.place.name,
			subtitle: preview.place.location.split(' › ').slice(0, -1).join(' › ') || undefined,
			person: `Deletes ${plural(places, 'place')}, ${plural(people, 'person').replace('persons', 'people')} and ${plural(reports, 'report')}${preview.accounts.length ? `; ${plural(preview.accounts.filter((a) => a.action === 'retire').length, 'account')} retired` : ''}`
		}
	};
}

// ---- from a CSV: the hierarchy columns, then the type's friendly name for the place

type Column = { header: string; required: boolean; level?: HierarchyConstraint; place?: true };

export function deleteColumns(contactType: ContactType): Column[] {
	return [
		...[...contactType.hierarchy].sort((a, b) => b.level - a.level).map((level) => ({ header: level.friendly_name, required: level.required, level })),
		{ header: contactType.friendly, required: true, place: true as const }
	];
}

export function stagedDeleteRow(
	contactType: ContactType,
	row: Record<string, string>,
	source: { file: string; row: number; sequence: number; stagedAt: string }
): StagedItem {
	const errors: ValidationErrors = {};
	for (const level of contactType.hierarchy) {
		if (level.required && !row[level.friendly_name]?.trim()) errors[`hierarchy.${level.property_name}`] = 'Is Required';
	}
	const name = row[contactType.friendly]?.trim() ?? '';
	if (!name) errors.place = 'Is Required';
	const invalid = Object.keys(errors).length > 0;
	return {
		id: randomUUID(),
		kind: 'delete',
		request: { jobId: randomUUID(), contactType: contactType.name, placeId: '', confirmName: '' },
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

// Background checks for delete rows: find each place by name under its parent, then the delete's own
// checks. A row that passes waits in needs_confirmation until its name is typed: never confirmed in
// bulk (APP.md → Merging and deleting in the UI and CSV).
export async function validateDeleteItems(
	deps: StagedDeps,
	owner: ListOwner,
	items: StagedItem[],
	save: (item: StagedItem, change: Partial<StagedItem>) => Promise<void>
): Promise<void> {
	if (!items.length) return;
	const { cht, session } = deps.context;
	// each parent's places are read once for the whole file
	const places = placeLookup(cht);
	const list = await deps.store.list(owner);

	for (const item of items) {
		const contactType = getContactType(item.request.contactType);
		const raw = item.raw ?? {};
		const names = Object.fromEntries(contactType.hierarchy.map((level) => [level.property_name, raw[level.friendly_name] ?? '']));
		const hierarchy = await resolveHierarchy(contactType, names, places, (doc) => isWithinFacilities(session, doc));
		const errors: ValidationErrors = { ...(item.errors ?? {}), ...hierarchy.errors };
		const request = { ...item.request };

		const name = raw[contactType.friendly]?.trim() ?? '';
		if (hierarchy.parent && name) {
			const wanted = normalize(formatValue(contactType.replacement_property, name));
			const matches = (await places.under(hierarchy.parent!._id, contactType.name)).filter(
				(doc) => normalize(formatValue(contactType.replacement_property, String(doc.name ?? ''))) === wanted
			);
			if (!matches.length) errors.place = `Can't find ${contactType.friendly} "${name}" under "${hierarchy.parent.name}"`;
			else if (matches.length > 1) errors.place = `Found ${matches.length} places called "${name}" under "${hierarchy.parent.name}"`;
			else request.placeId = matches[0]._id;
		}

		let change: Partial<StagedItem>;
		if (Object.keys(errors).length || !request.placeId) {
			change = { status: 'invalid', errors, request, summary: { ...item.summary, subtitle: hierarchy.path || item.summary.subtitle } };
		} else {
			try {
				const parsed = parseDeleteItem(request);
				const staged = await stageDelete(deps, parsed, list, { requireConfirmation: false, self: item.id });
				change = {
					status: 'needs_confirmation',
					confirmation: { reason: 'typed_name', expected: String(staged.placeDoc.name ?? '') },
					errors: undefined,
					request: parsed,
					summary: staged.summary,
					claims: staged.claims
				};
			} catch (e) {
				if (!(e instanceof ApiError)) throw e;
				change = { status: 'invalid', errors: { place: e.message }, request, summary: { ...item.summary, subtitle: hierarchy.path || item.summary.subtitle } };
			}
		}
		const index = list.findIndex((other) => other.id === item.id);
		if (index >= 0) list[index] = { ...list[index], ...change };
		await save(item, change);
	}
}
