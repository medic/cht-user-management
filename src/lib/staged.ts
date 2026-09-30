import type { ContactType } from './config-types';

// What the frontend needs to know about staged items (docs/api-contract.md §6)

export type StagedStatus = 'pending' | 'validating' | 'invalid' | 'needs_confirmation' | 'ready' | 'uploading' | 'created' | 'failed';
export type StagedKind = 'create' | 'replace' | 'move' | 'merge' | 'delete';

export type StagedItem = {
	id: string;
	kind: StagedKind;
	request: Record<string, any>;
	source: { type: 'form' } | { type: 'csv'; file: string; row: number };
	// CSV rows only: the row as uploaded
	raw?: Record<string, string>;
	status: StagedStatus;
	errors?: Record<string, string>;
	confirmation?: { reason: 'duplicates'; warnings: (StagedWarning | string)[] } | { reason: 'large_move'; counts: Record<string, number> } | { reason: 'typed_name'; expected: string };
	// another place for the person that item creates
	dependsOn?: string;
	summary: { title: string; subtitle?: string; person?: string; target?: { placeId: string; name: string } };
	result?: { username?: string; placeId?: string; [key: string]: unknown };
	// the upload that last sent it
	upload?: { runId: string; startedAt: string };
	// delete items, once uploaded: the job they scheduled
	job?: import('./api').JobView;
	failure?: { code: string; message: string };
	revision: number;
};

// ---- the list's timeline: what isn't uploaded, then each upload (APP.md → Staged list)

export const NOT_UPLOADED = '';
export const UPLOADED_EARLIER = 'earlier';

// Which group an item is shown in: '' while it isn't uploaded (failed items too), else its upload,
// as "startedAt|runId" so later uploads sort later; "earlier" for items uploaded before uploads were
// recorded on items. The server orders the list by this; the page draws a group wherever it changes.
export function uploadGroup(item: { status: string; upload?: { runId: string; startedAt: string } }): string {
	if (item.status !== 'created' && item.status !== 'uploading') {
		return NOT_UPLOADED;
	}
	return item.upload ? `${item.upload.startedAt}|${item.upload.runId}` : UPLOADED_EARLIER;
}

// A warning to confirm; placeIds are the existing places it's about. Items staged before warnings
// carried ids hold plain strings.
export type StagedWarning = { message: string; placeIds?: string[] };

export const asWarning = (warning: StagedWarning | string): StagedWarning => (typeof warning === 'string' ? { message: warning } : warning);

// Opens a contact in the CHT app
export const contactUrl = (instanceUrl: string, id: string) => `${instanceUrl}/#/contacts/${encodeURIComponent(id)}`;

// A person kept for another place (APP.md → One person, many places): the request sends only
// their id. The details are shown, when known, but edited on the item that creates them.
export type SharedPerson = {
	contactId: string;
	name?: string;
	properties?: Record<string, string | string[]>;
	roles?: string[];
	// the place they were first added with
	placeTitle?: string;
};

// A person already in the staged list that a new form entry looks like (POST /checks/same-person)
export type StagedPersonMatch = {
	itemId: string;
	contactId: string;
	name?: string;
	placeTitle: string;
	properties: Record<string, string | string[]>;
	roles?: string[];
};

// The person an item's place shares, if it's a later place for someone another item creates, or for
// someone already in CHT
export function sharedPersonOf(item: StagedItem, personItem?: StagedItem | null): SharedPerson | null {
	if (item.kind !== 'create' || item.request.contact?.properties) {
		return null;
	}
	return {
		contactId: item.request.contact?.id,
		name: item.summary.person,
		properties: personItem?.request.contact?.properties,
		roles: item.request.user?.roles ?? personItem?.request.user?.roles,
		placeTitle: personItem?.summary.title
	};
}

// A new place for the person this item creates, or shares
export function personFrom(item: StagedItem): SharedPerson {
	return (
		sharedPersonOf(item) ?? {
			contactId: item.request.contact?.id,
			name: item.summary.person,
			properties: item.request.contact?.properties,
			roles: item.request.user?.roles,
			placeTitle: item.summary.title
		}
	);
}

export type StagedList = {
	items: StagedItem[];
	nextCursor?: string;
	total: number;
	counts: Partial<Record<StagedStatus, number>>;
	upload: { state: 'running' | 'idle'; done: number; total: number };
	validation: { state: 'running' | 'idle'; done: number; total: number };
};

export const KIND_LABELS: Record<StagedKind, string> = {
	create: 'Create',
	replace: 'Replace',
	move: 'Move',
	merge: 'Merge',
	delete: 'Delete'
};

export const STATUS_LABELS: Record<StagedStatus, string> = {
	pending: 'Waiting to check',
	validating: 'Checking',
	invalid: 'Needs fixing',
	needs_confirmation: 'Needs confirmation',
	ready: 'Ready',
	uploading: 'Uploading',
	created: 'Done',
	failed: 'Failed'
};

export const JOB_KIND_LABELS: Record<import('./api').JobView['kind'], string> = {
	move: 'Move',
	merge: 'Merge',
	delete: 'Delete',
	restore: 'Undo delete'
};

// a scheduled job's status, on the item that scheduled it
export const JOB_LABELS: Record<import('./api').JobStatus, string> = {
	queued: 'Scheduled',
	postponed: 'Postponed',
	needs_sign_in: 'Needs sign-in',
	running: 'Running',
	done: 'Done',
	failed: 'Job failed'
};

// jobs that change on their own, so the page should keep checking while any are present
export const MOVING_JOBS = ['queued', 'postponed', 'running'];

// the order statuses appear in the filter bar: the ones needing attention first
export const STATUS_ORDER: StagedStatus[] = ['invalid', 'needs_confirmation', 'failed', 'ready', 'pending', 'validating', 'uploading', 'created'];

// statuses that change on their own, so the page should keep checking while any are present
export const MOVING_STATUSES: StagedStatus[] = ['pending', 'validating', 'uploading'];

// "hierarchy.SUBCOUNTY" → "Sub County": the label the config gives the field, or else the property
// name made readable
export function fieldLabel(path: string, contactType?: ContactType): string {
	const [section, name = path] = path.split('.');
	const properties =
		section === 'hierarchy' ? contactType?.hierarchy : section === 'place' ? contactType?.place_properties : section === 'contact' ? contactType?.contact_properties : undefined;
	const configured = properties?.find((p) => p.property_name === name)?.friendly_name;
	if (configured) return configured;
	if (path === 'user.roles') return 'Roles';
	if (path === 'replacement') return contactType?.replacement_property.friendly_name ?? 'Place being replaced';
	if (path === 'contact.id') return contactType?.contact_friendly ?? 'Who takes over';
	if (path === 'scope') return 'Scope';
	const words = name.replace(/_/g, ' ').toLowerCase();
	return words.charAt(0).toUpperCase() + words.slice(1);
}
