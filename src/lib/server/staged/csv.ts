import { randomUUID } from 'node:crypto';
import { parse } from 'csv-parse/sync';

import type { ContactProperty, ContactType, HierarchyConstraint } from '../../config-types';
import { buildProperties, resolveRoles, type Lineage, type PropertyInput, type ValidationErrors } from '../../validation';
import { formatValue } from '../../validation/validators';
import { getContactType } from '../config';
import type { CouchDoc } from '../cht/client';
import { ApiError } from '../errors';
import { batchWarnings } from '../places/batch';
import { isWithinFacilities } from '../places/directory';
import { lineageIds } from '../places/documents';
import { placeLookup, type PlaceLookup } from '../places/lookup';
import type { CreateRequest } from '../places/schemas';
import { normalize, uniquePropertyWarnings, type Warning } from '../places/unique';
import { ownerOf } from './owner';
import { replaceColumns, stagedReplaceRow, validateReplaceItems } from './replace-csv';
import { deleteColumns, stagedDeleteRow, validateDeleteItems } from './delete-items';
import { moveColumns, stagedMoveRow, validateMoveItems } from './move-items';
import { mergeColumns, stagedMergeRow, validateMergeItems } from './merge-items';
import { itemPersonKey, stagedPeople } from './people';
import type { StagedDeps } from './service';
import type { ListOwner, StagedItem } from './types';
import { LOCK_MS } from './upload-tracker';

export const ROLES_COLUMN = 'Roles';
const MAX_ROWS = 5000;

type Column = { header: string; required: boolean; level?: HierarchyConstraint; place?: ContactProperty; contact?: ContactProperty; roles?: true };

// The columns of a create CSV, in template order: the hierarchy top-first, then the place, the
// person, and Roles when the type has several (APP.md → Creating many users). Generated
// properties are left out; they're computed.
export function createColumns(contactType: ContactType): Column[] {
	const columns: Column[] = [
		...[...contactType.hierarchy].sort((a, b) => b.level - a.level).map((level) => ({ header: level.friendly_name, required: level.required, level })),
		...contactType.place_properties.filter((p) => p.type !== 'generated').map((place) => ({ header: place.friendly_name, required: place.required, place })),
		...contactType.contact_properties.filter((p) => p.type !== 'generated').map((contact) => ({ header: contact.friendly_name, required: contact.required, contact }))
	];
	if (contactType.user_role.length > 1) {
		columns.push({ header: ROLES_COLUMN, required: true, roles: true });
	}
	return columns;
}

export type CsvKind = 'create' | 'replace' | 'move' | 'merge' | 'delete';

function columnsFor(contactType: ContactType, kind: CsvKind): { header: string; required: boolean }[] {
	if (kind === 'replace') return replaceColumns(contactType);
	if (kind === 'move') return moveColumns(contactType);
	if (kind === 'merge') return mergeColumns(contactType);
	if (kind === 'delete') return deleteColumns(contactType);
	return createColumns(contactType);
}

export function templateCsv(contactType: ContactType, kind: CsvKind = 'create'): string {
	const columns = columnsFor(contactType, kind);
	const headers = [...new Set(columns.map((column) => column.header))];
	return headers.map((header) => `"${header.replace(/"/g, '""')}"`).join(',') + '\r\n';
}

type Row = Record<string, string>;

function parseRows(text: string): Row[] {
	try {
		return parse(text, { columns: true, bom: true, trim: true, skip_empty_lines: true, relax_column_count: true }) as Row[];
	} catch (e) {
		throw new ApiError(400, 'CSV_UNREADABLE', `The file isn't a readable CSV: ${(e as Error).message}`);
	}
}

// POST /api/v1/staged-items/csv: stage every row straight away, check what needs no CHT, and leave
// the rest to a background run (APP.md → Adding from a CSV: pre-validation)
export async function stageCsv(
	deps: StagedDeps,
	input: { fileName: string; text: string; contactType: string; kind?: CsvKind }
): Promise<{ staged: number; invalid: number; sharedPeople?: number }> {
	const kind = input.kind ?? 'create';
	const contactType = getContactType(input.contactType, kind);
	const columns = columnsFor(contactType, kind);
	const rows = parseRows(input.text);
	if (!rows.length) {
		throw new ApiError(400, 'CSV_EMPTY', 'The file has no rows.');
	}
	if (rows.length > MAX_ROWS) {
		throw new ApiError(413, 'CSV_TOO_LARGE', `A file may have at most ${MAX_ROWS} rows. Split it and upload each part.`, { maxRows: MAX_ROWS });
	}

	const present = new Set(Object.keys(rows[0]));
	const missing = [...new Set(columns.filter((c) => c.required && !present.has(c.header)).map((c) => c.header))];
	if (missing.length) {
		throw new ApiError(400, 'MISSING_COLUMNS', `The file is missing required columns: ${missing.join(', ')}`, { columns: missing });
	}

	const owner = ownerOf(deps.context);
	const base = Date.now() * 1000;
	// one time for the whole file, so the list keeps its rows together, in file order
	const stagedAt = new Date().toISOString();
	const items = rows.map((row, index) => {
		const source = { file: input.fileName, row: index + 2, sequence: base + index, stagedAt };
		if (kind === 'replace') return stagedReplaceRow(contactType, replaceColumns(contactType), row, source);
		if (kind === 'delete') return stagedDeleteRow(contactType, row, source);
		if (kind === 'move') return stagedMoveRow(contactType, row, source);
		if (kind === 'merge') return stagedMergeRow(contactType, row, source);
		return stagedRow(contactType, createColumns(contactType), row, source);
	});
	const shared = kind === 'create' && contactType.can_assign_multiple ? sharePeople(contactType, items, await deps.store.list(owner)) : 0;
	for (const item of items) {
		await deps.store.put(owner, item, null);
	}

	void runValidation(deps);
	return { staged: rows.length, invalid: items.filter((item) => item.status === 'invalid').length, ...(shared ? { sharedPeople: shared } : {}) };
}

// One person, many places (APP.md → One person, many places): rows whose person looks the same as a
// person already in the staged list, or as an earlier row, are that person. The item creating them
// stays as it is; the rows become later places for them, sending only the person's id. Returns how
// many people now serve more than one item.
function sharePeople(contactType: ContactType, items: StagedItem[], staged: StagedItem[]): number {
	const people = stagedPeople(contactType, staged);
	const sharing = new Set<string>();
	for (const item of items) {
		const key = itemPersonKey(contactType, item);
		if (!key) {
			continue;
		}
		const personItem = people.get(key);
		if (!personItem) {
			people.set(key, item);
			continue;
		}
		item.request.contact = { id: personItem.request.contact.id };
		item.dependsOn = personItem.id;
		sharing.add(key);
	}
	return sharing.size;
}

function stagedRow(
	contactType: ContactType,
	columns: Column[],
	row: Row,
	source: { file: string; row: number; sequence: number; stagedAt: string }
): StagedItem {
	const place: PropertyInput = {};
	const contact: PropertyInput = {};
	let roles: string[] | undefined;
	const names: Record<string, string> = {};
	for (const column of columns) {
		const value = row[column.header] ?? '';
		if (column.level) names[column.level.property_name] = value;
		if (column.place && value) place[column.place.property_name] = value;
		if (column.contact && value) contact[column.contact.property_name] = value;
		if (column.roles && value) roles = value.split(/[\s,;]+/).filter(Boolean);
	}

	// the checks that need nothing from CHT
	const built = buildProperties({ contactType, mode: 'create', place, contact, lineage: {} });
	const errors: ValidationErrors = withoutLineageErrors(contactType, built.errors);
	for (const level of contactType.hierarchy) {
		if (level.required && !names[level.property_name]) {
			errors[`hierarchy.${level.property_name}`] = 'Is Required';
		}
	}
	const resolvedRoles = resolveRoles(contactType, roles);
	if (resolvedRoles.error) {
		errors['user.roles'] = resolvedRoles.error;
	}

	const now = source.stagedAt;
	const hasErrors = Object.keys(errors).length > 0;
	return {
		id: randomUUID(),
		kind: 'create',
		request: {
			contactType: contactType.name,
			placeId: randomUUID(),
			parentId: '',
			place,
			contact: { id: randomUUID(), properties: contact },
			...(roles ? { user: { roles } } : {}),
			ignoreWarnings: false
		},
		source: { type: 'csv', file: source.file, row: source.row },
		raw: row,
		status: hasErrors ? 'invalid' : 'pending',
		errors: hasErrors ? errors : undefined,
		summary: {
			title: built.place.name || row[columns.find((c) => c.place?.property_name === 'name')?.header ?? ''] || `Row ${source.row}`,
			subtitle: hierarchyPath(contactType, names) || undefined,
			person: built.contact.name || undefined
		},
		revision: 0,
		sequence: source.sequence,
		createdAt: now,
		updatedAt: now
	};
}

// Generated properties that read the lineage can't be checked until the hierarchy is resolved
function withoutLineageErrors(contactType: ContactType, errors: ValidationErrors): ValidationErrors {
	const readsLineage = new Set(
		[...contactType.place_properties.map((p) => ['place', p] as const), ...contactType.contact_properties.map((p) => ['contact', p] as const)]
			.filter(([, p]) => p.type === 'generated' && /\blineage\b/.test(String(p.parameter)))
			.map(([section, p]) => `${section}.${p.property_name}`)
	);
	return Object.fromEntries(Object.entries(errors).filter(([key]) => !readsLineage.has(key)));
}

function hierarchyPath(contactType: ContactType, names: Record<string, string>): string {
	return [...contactType.hierarchy]
		.sort((a, b) => b.level - a.level)
		.map((level) => names[level.property_name])
		.filter(Boolean)
		.join(' › ');
}

// ---- the background run

// Checks every pending item. One run per list at a time; items staged meanwhile are picked up by a
// later pass of the same run.
// Pending rows, and rows that failed the local checks but haven't been looked up in CHT yet: their
// places are still resolved, so fixing them only means fixing what's actually wrong
const needsChecking = (item: StagedItem) =>
	item.status === 'pending' || item.status === 'validating' || (item.source.type === 'csv' && item.status === 'invalid' && !item.checkedWithCht);

export async function runValidation(deps: StagedDeps): Promise<void> {
	const owner = ownerOf(deps.context);
	const pending = (await deps.store.list(owner)).filter(needsChecking);
	if (!pending.length) {
		return;
	}
	const runId = await deps.validationTracker.begin(owner, pending.length);
	if (!runId) {
		return;
	}

	const heartbeat = setInterval(() => void deps.validationTracker.heartbeat(owner, runId).catch(() => undefined), LOCK_MS / 3);
	try {
		for (let pass = 0; pass < 10; pass++) {
			const items = (await deps.store.list(owner)).filter(needsChecking).sort((a, b) => a.sequence - b.sequence);
			if (!items.length) {
				break;
			}
			await validateItems(
				deps,
				owner,
				items.filter((item) => item.kind === 'create')
			);
			const save = async (item: StagedItem, change: Partial<StagedItem>) => {
				const current = await deps.store.get(owner, item.id);
				// skipped if the user edited or removed the item meanwhile
				if (current && needsChecking(current) && current.revision === item.revision) {
					await deps.store.put(owner, { ...current, ...change, checkedWithCht: true }, current.revision);
				}
				await deps.validationTracker.step(owner);
			};
			await validateReplaceItems(
				deps,
				owner,
				items.filter((item) => item.kind === 'replace'),
				save
			);
			await validateDeleteItems(
				deps,
				owner,
				items.filter((item) => item.kind === 'delete'),
				save
			);
			await validateMoveItems(
				deps,
				owner,
				items.filter((item) => item.kind === 'move'),
				save
			);
			await validateMergeItems(
				deps,
				owner,
				items.filter((item) => item.kind === 'merge'),
				save
			);
		}
	} catch (e) {
		console.error('background validation stopped', e);
	} finally {
		clearInterval(heartbeat);
		await deps.validationTracker.end(owner, runId);
	}
}

// person: the details of the person a later place shares, from the row that creates them
type Resolved = { item: StagedItem; parent?: CouchDoc; lineage: Lineage; path: string; errors: ValidationErrors; person?: PropertyInput };

async function validateItems(deps: StagedDeps, owner: ListOwner, items: StagedItem[]): Promise<void> {
	if (!items.length) {
		return;
	}
	const { cht, session } = deps.context;
	// each parent's places are read once for the whole file
	const places = placeLookup(cht);

	const all = new Map((await deps.store.list(owner)).map((item) => [item.id, item]));
	const personOf = (item: StagedItem): PropertyInput | undefined =>
		item.dependsOn ? all.get(item.dependsOn)?.request.contact?.properties : undefined;

	// resolve every item's names first, so rows can then be compared with each other
	const resolved: Resolved[] = [];
	for (const item of items) {
		const contactType = getContactType(item.request.contactType);
		const names = Object.fromEntries(contactType.hierarchy.map((level) => [level.property_name, item.raw?.[level.friendly_name] ?? '']));
		resolved.push({ item, person: personOf(item), ...(await resolveHierarchy(contactType, names, places, (doc) => isWithinFacilities(session, doc))) });
	}

	// the full location, as form items show it: the parent's real ancestors, fetched once for the run
	const ancestorIds = [...new Set(resolved.flatMap((r) => (r.parent ? lineageIds(r.parent) : [])))];
	const ancestorNames = new Map((await cht.getDocs(ancestorIds)).map((doc) => [doc._id, String(doc.name ?? '')]));
	for (const r of resolved) {
		if (r.parent) {
			const names = [...lineageIds(r.parent).map((id) => ancestorNames.get(id) ?? '').reverse(), String(r.parent.name ?? '')];
			r.path = names.filter(Boolean).join(' › ');
		}
	}

	const complete = resolved.filter((r) => r.parent && !Object.keys(r.errors).length);
	const betweenRows = batchWarnings(
		complete.map((r) => ({ op: 'create' as const, placeId: r.item.request.placeId, body: { ...r.item.request, parentId: r.parent!._id } as CreateRequest }))
	);

	for (const r of resolved) {
		const change = await finish(deps, r, betweenRows[complete.indexOf(r)] ?? []);
		const current = await deps.store.get(owner, r.item.id);
		// skipped if the user edited or removed the item meanwhile
		if (current && needsChecking(current) && current.revision === r.item.revision) {
			await deps.store.put(owner, { ...current, ...change, checkedWithCht: true }, current.revision);
		}
		await deps.validationTracker.step(owner);
	}
}

async function finish(deps: StagedDeps, r: Resolved, rowWarnings: Warning[]): Promise<Partial<StagedItem>> {
	const contactType = getContactType(r.item.request.contactType);
	const subtitle = r.path || r.item.summary.subtitle;
	if (!r.parent || Object.keys(r.errors).length) {
		// the property errors too, so a row wrong in several ways shows everything at once
		const local = buildProperties({
			contactType,
			mode: 'create',
			place: r.item.request.place,
			contact: r.item.request.contact.properties,
			existingContact: r.person,
			lineage: r.lineage
		});
		return { status: 'invalid', errors: { ...withoutLineageErrors(contactType, local.errors), ...r.errors }, summary: { ...r.item.summary, subtitle } };
	}

	const request: StagedItem['request'] = { ...r.item.request, parentId: r.parent._id };
	// a later place for a shared person sends no person details; its person's row checks them
	const built = buildProperties({
		contactType,
		mode: 'create',
		place: request.place,
		contact: request.contact.properties,
		existingContact: r.person,
		lineage: r.lineage
	});
	const errors: ValidationErrors = { ...built.errors };
	const roles = resolveRoles(contactType, request.user?.roles);
	if (roles.error) errors['user.roles'] = roles.error;
	const summary = { title: built.place.name ?? r.item.summary.title, subtitle, person: built.contact.name ?? r.item.summary.person };
	if (Object.keys(errors).length) {
		return { status: 'invalid', errors, request, summary };
	}

	const warnings = [
		...rowWarnings,
		...(await uniquePropertyWarnings(deps.context.cht, contactType, { placeId: request.placeId, parentId: r.parent._id, values: built.place }))
	];
	if (warnings.length) {
		return { status: 'needs_confirmation', confirmation: { reason: 'duplicates', warnings }, errors: undefined, request, summary };
	}
	return { status: 'ready', errors: undefined, request, summary };
}

// Top level first; each level is only looked for under the place found above it
export async function resolveHierarchy(
	contactType: ContactType,
	names: Record<string, string>,
	places: PlaceLookup,
	allowed: (doc: CouchDoc) => boolean
): Promise<Omit<Resolved, 'item'>> {
	const errors: ValidationErrors = {};
	const lineage: Lineage = {};
	const path: string[] = [];
	let above: { doc: CouchDoc; level: number } | undefined;
	let parent: CouchDoc | undefined;

	for (const level of [...contactType.hierarchy].sort((a, b) => b.level - a.level)) {
		const name = names[level.property_name]?.trim();
		const key = `hierarchy.${level.property_name}`;
		if (!name) {
			if (level.required) errors[key] = 'Is Required';
			continue;
		}

		const wanted = normalize(formatValue(level, name));
		// under the place found above, only its places are read: the way a type too large to read whole is found
		const candidates = above ? await places.under(above.doc._id, level.contact_type, above.level - level.level) : await places.all(level.contact_type);
		const under = above ? ` under "${above.doc.name}"` : '';
		if (!candidates) {
			const higher = contactType.hierarchy.filter((l) => l.level > level.level).sort((a, b) => a.level - b.level)[0];
			errors[key] = `There are too many places to find ${level.friendly_name} "${name}" among them all${higher ? `: fill in ${higher.friendly_name}` : ''}`;
			continue;
		}
		const matches = candidates.filter((doc) => normalize(formatValue(level, String(doc.name ?? ''))) === wanted);

		if (!matches.length) {
			errors[key] = `Can't find ${level.friendly_name} "${name}"${under}`;
			above = undefined;
			continue;
		}
		if (matches.length > 1) {
			errors[key] = `Found ${matches.length} places called "${name}"${under}. Fill in the level above to tell them apart.`;
			above = undefined;
			continue;
		}

		const [doc] = matches;
		if (!allowed(doc)) {
			errors[key] = `${level.friendly_name} "${doc.name}" is outside the places you manage`;
			above = undefined;
			continue;
		}
		above = { doc, level: level.level };
		lineage[level.property_name] = formatValue(level, String(doc.name ?? ''));
		path.push(String(doc.name ?? ''));
		if (level.level === 1) parent = doc;
	}

	return { parent: Object.keys(errors).length ? undefined : parent, lineage, path: path.join(' › '), errors };
}
