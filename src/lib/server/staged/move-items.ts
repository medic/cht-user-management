import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import type { ContactType, HierarchyConstraint } from '../../config-types';
import type { ValidationErrors } from '../../validation';
import { formatValue } from '../../validation/validators';
import type { CouchDoc } from '../cht/client';
import { getContactType } from '../config';
import { ApiError } from '../errors';
import type { JobStore } from '../hierarchy/jobs';
import { previewMove } from '../hierarchy/move';
import { lineageIds } from '../places/documents';
import { isWithinFacilities } from '../places/directory';
import { docId, newJobId } from '../places/schemas';
import { placeLookup } from '../places/lookup';
import { normalize } from '../places/unique';
import { resolveHierarchy } from './csv';
import type { StagedDeps } from './service';
import type { ListOwner, StagedItem } from './types';

// Move items in the staged list (APP.md → Moving places → Moving in the UI, Moving many). Uploading
// one schedules its job; from then on the item shows the job's status.

export const moveItemRequest = z
	.object({
		jobId: newJobId,
		contactType: z.string().min(1),
		placeId: docId,
		newParentId: docId,
		// a large move, accepted: ticked in the form, or confirmed in the list for a CSV row
		acceptLarge: z.boolean().default(false)
	})
	.strict();
export type MoveItemRequest = z.infer<typeof moveItemRequest>;

export function parseMoveItem(request: unknown): MoveItemRequest {
	const parsed = moveItemRequest.safeParse(request);
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

const waiting = (item: StagedItem) => ['move', 'merge', 'delete'].includes(item.kind) && item.status !== 'created';

// The move's own checks, then the list's: the same place moved twice, or moved under a place that
// another waiting item moves or deletes, would have the two overwrite each other.
// `claims`: the place and everything above it. `targets`: the new parent and everything above it.
export async function stageMove(
	deps: StagedDeps,
	request: MoveItemRequest,
	all: StagedItem[],
	options: { requireLargeAccepted: boolean; self?: string }
): Promise<{ summary: StagedItem['summary']; claims: string[]; targets: string[]; large: boolean; counts: { places: number; people: number } }> {
	const { cht, session } = deps.context;
	const preview = await previewMove(cht, session, jobStore(deps), request);
	if (options.requireLargeAccepted && preview.large && !request.acceptLarge) {
		throw new ApiError(422, 'CONFIRMATION_REQUIRED', `This is a large move (${preview.counts.places + preview.counts.people} places and people). Confirm it to add it.`, {
			large: true
		});
	}
	const placeDoc = (await cht.getDoc(request.placeId))!;
	const parentDoc = (await cht.getDoc(request.newParentId))!;
	const claims = [placeDoc._id, ...lineageIds(placeDoc)];
	const targets = [parentDoc._id, ...lineageIds(parentDoc)];

	for (const other of all.filter((item) => item.id !== options.self && waiting(item) && item.claims)) {
		const theirs = other.claims![0];
		const clash =
			theirs === placeDoc._id ||
			// moving under a place another item moves or deletes
			targets.includes(theirs) ||
			// or the other moves something under the place this one moves
			(other.targets ?? []).includes(placeDoc._id);
		if (clash) {
			throw new ApiError(409, 'MOVE_ALREADY_STAGED', `This overlaps "${other.summary.title}", already waiting in your staged list. Remove or change one of them.`, {
				itemId: other.id
			});
		}
	}

	const { places, people } = preview.counts;
	const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
	return {
		claims,
		targets,
		large: preview.large,
		counts: preview.counts,
		summary: {
			title: preview.place.name,
			subtitle: preview.from.split(' › ').slice(0, -1).join(' › ') || undefined,
			person: `${preview.alreadyThere ? 'Already under' : 'Moves to'} ${preview.to.split(' › ').slice(0, -1).join(' › ')}, with ${plural(places, 'place')} and ${plural(people, 'person', 'people')}`,
			// the new parent, linked where its breadcrumb appears
			target: { placeId: request.newParentId, name: preview.to.split(' › ').slice(0, -1).join(' › ') }
		}
	};
}

// ---- from a CSV: where the place is now, the place, then where it goes (APP.md → Moving many)

type Column = { header: string; required: boolean; level?: HierarchyConstraint; newLevel?: HierarchyConstraint; place?: true };

export const NEW_PREFIX = 'New ';

export function moveColumns(contactType: ContactType): Column[] {
	const levels = [...contactType.hierarchy].sort((a, b) => b.level - a.level);
	return [
		...levels.map((level) => ({ header: level.friendly_name, required: level.required, level })),
		{ header: contactType.friendly, required: true, place: true as const },
		...levels.map((level) => ({ header: `${NEW_PREFIX}${level.friendly_name}`, required: level.required, newLevel: level }))
	];
}

export function stagedMoveRow(contactType: ContactType, row: Record<string, string>, source: { file: string; row: number; sequence: number; stagedAt: string }): StagedItem {
	const errors: ValidationErrors = {};
	for (const level of contactType.hierarchy) {
		if (level.required && !row[level.friendly_name]?.trim()) errors[`hierarchy.${level.property_name}`] = 'Is Required';
		if (level.required && !row[`${NEW_PREFIX}${level.friendly_name}`]?.trim()) errors[`new.${level.property_name}`] = 'Is Required';
	}
	const name = row[contactType.friendly]?.trim() ?? '';
	if (!name) errors.place = 'Is Required';
	const invalid = Object.keys(errors).length > 0;
	return {
		id: randomUUID(),
		kind: 'move',
		request: { jobId: randomUUID(), contactType: contactType.name, placeId: '', newParentId: '', acceptLarge: false },
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

// Background checks for move rows: the place where it is now, and the new parent, both found by name
// in the in-memory indexes; then the move's own checks. Large moves wait in needs_confirmation, and
// may be confirmed together.
export async function validateMoveItems(
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
		const allowed = (doc: CouchDoc) => isWithinFacilities(session, doc);
		const now = await resolveHierarchy(contactType, Object.fromEntries(contactType.hierarchy.map((l) => [l.property_name, raw[l.friendly_name] ?? ''])), places, allowed);
		const next = await resolveHierarchy(
			contactType,
			Object.fromEntries(contactType.hierarchy.map((l) => [l.property_name, raw[`${NEW_PREFIX}${l.friendly_name}`] ?? ''])),
			places,
			allowed
		);
		const errors: ValidationErrors = {
			...(item.errors ?? {}),
			...now.errors,
			...Object.fromEntries(Object.entries(next.errors).map(([key, message]) => [key.replace(/^hierarchy\./, 'new.'), message]))
		};
		const request: StagedItem['request'] = { ...item.request, newParentId: next.parent?._id ?? '' };

		const name = raw[contactType.friendly]?.trim() ?? '';
		if (now.parent && name) {
			const wanted = normalize(formatValue(contactType.replacement_property, name));
			const matches = (await places.under(now.parent!._id, contactType.name)).filter(
				(doc) => normalize(formatValue(contactType.replacement_property, String(doc.name ?? ''))) === wanted
			);
			if (!matches.length) errors.place = `Can't find ${contactType.friendly} "${name}" under "${now.parent.name}"`;
			else if (matches.length > 1) errors.place = `Found ${matches.length} places called "${name}" under "${now.parent.name}"`;
			else request.placeId = matches[0]._id;
		}

		let change: Partial<StagedItem>;
		if (Object.keys(errors).length || !request.placeId || !request.newParentId) {
			change = { status: 'invalid', errors, request, summary: { ...item.summary, subtitle: now.path || item.summary.subtitle } };
		} else {
			try {
				const parsed = parseMoveItem(request);
				const staged = await stageMove(deps, parsed, list, { requireLargeAccepted: false, self: item.id });
				change = {
					...(staged.large
						? { status: 'needs_confirmation', confirmation: { reason: 'large_move', counts: staged.counts } }
						: { status: 'ready', confirmation: undefined }),
					errors: undefined,
					request: parsed,
					summary: staged.summary,
					claims: staged.claims,
					targets: staged.targets
				} as Partial<StagedItem>;
			} catch (e) {
				if (!(e instanceof ApiError)) throw e;
				change = { status: 'invalid', errors: { place: e.message }, request, summary: { ...item.summary, subtitle: now.path || item.summary.subtitle } };
			}
		}
		const index = list.findIndex((other) => other.id === item.id);
		if (index >= 0) list[index] = { ...list[index], ...change };
		await save(item, change);
	}
}
