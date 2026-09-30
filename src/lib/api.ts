// Browser-side access to the tool's own API (docs/api-contract.md). The frontend never calls CHT.

export class ApiRequestError extends Error {
	constructor(
		public readonly status: number,
		public readonly code: string,
		message: string,
		public readonly details?: Record<string, unknown>
	) {
		super(message);
		this.name = 'ApiRequestError';
	}
}

const NETWORK_ERROR = new ApiRequestError(0, 'NETWORK', "Couldn't reach the server. Check your connection and try again.");

// Sends JSON, returns the parsed body, and throws the API's error envelope as an ApiRequestError
export async function api<T>(
	fetcher: typeof fetch,
	path: string,
	init: { method?: string; body?: unknown; configVersion?: string } = {}
): Promise<T> {
	const headers: Record<string, string> = {};
	if (init.body !== undefined) headers['Content-Type'] = 'application/json';
	// writes say which rules they were checked with, so the server can refuse a stale page
	if (init.configVersion) headers['X-Config-Version'] = init.configVersion;

	let response: Response;
	try {
		response = await fetcher(`/api/v1${path}`, {
			method: init.method ?? 'GET',
			headers,
			body: init.body === undefined ? undefined : JSON.stringify(init.body)
		});
	} catch {
		throw NETWORK_ERROR;
	}

	if (response.status === 204) {
		return undefined as T;
	}

	const body = await response.json().catch(() => undefined);
	if (!response.ok) {
		const error = body?.error;
		throw new ApiRequestError(
			response.status,
			error?.code ?? 'UNKNOWN',
			error?.message ?? 'Something went wrong. Try again, or contact support.',
			error?.details
		);
	}
	return body as T;
}

export function isSignedOut(error: unknown): boolean {
	return error instanceof ApiRequestError && (error.code === 'UNAUTHENTICATED' || error.code === 'SESSION_EXPIRED');
}

// Only paths on this site, so a crafted ?next= can't send someone elsewhere after signing in
export function safeNext(next: string | null): string {
	return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/';
}

export function signInUrl(returnTo: URL | string): string {
	const path = typeof returnTo === 'string' ? returnTo : `${returnTo.pathname}${returnTo.search}`;
	return path === '/' ? '/login' : `/login?next=${encodeURIComponent(path)}`;
}

export type Instance = { id: string; name: string };

export type SessionInfo = {
	// url: the CHT app's origin, e.g. https://echis.example.org
	instance: Instance & { url: string };
	username: string;
	isAdmin: boolean;
	facilityIds: string[];
	chtVersion: string;
	expiresAt: string;
};

export type ContactTypesConfig = { configVersion: string; contactTypes: import('./config-types').ContactType[] };

export type PlaceSummary = { id: string; name: string; type: string; lineage: { id: string; name: string }[] };

// GET /places/{id}: the place, and who is behind it now
export type PlaceDetail = PlaceSummary & {
	properties: Record<string, string>;
	primaryContact: { id: string; name: string; phone?: string; properties: Record<string, string> } | null;
	accounts: { username: string; roles: string[]; active: boolean; places: { id: string; name: string }[] }[];
};

export type PersonNotEligible = 'NO_ACCOUNT' | 'SEVERAL_ACCOUNTS' | 'NO_ACTIVE_ACCOUNT' | 'MISSING_ROLE';

// GET /people/search: someone already here who could take over a place
export type PersonMatch = {
	id: string;
	name: string;
	phone?: string;
	account?: { username: string; active: boolean; roles: string[]; places: { id: string; name: string }[] };
	eligible: boolean;
	reason?: PersonNotEligible;
};

// POST /preview with kind "replace"
export type ReplacePreview = {
	state: 'fresh' | 'switched' | 'nothing_to_do';
	outgoing: { contactId: string; name: string } | null;
	incoming: { kind: 'new' | 'existing'; name: string; username?: string };
	placesHandedOver: { id: string; name: string }[];
	placesKept: { id: string; name: string }[];
	retiredAccounts: { username: string; action: 'disable' | 'deactivate' }[];
	keptAccounts: { username: string }[];
	outgoingPerson: 'keep' | null;
	generated: Record<string, { from: string; to: string }>;
};

export type JobStatus = 'queued' | 'postponed' | 'needs_sign_in' | 'running' | 'done' | 'failed';

// GET /hierarchy-jobs/{jobId}
export type JobView = {
	id: string;
	kind: 'move' | 'merge' | 'delete' | 'restore';
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- one of the kinds' requests, each checked by its own schema
	request: Record<string, any>;
	branch: { placeId: string; placeName: string; lineage: string[] };
	// a merge: the place it merges into
	target?: { placeId: string; placeName: string };
	status: JobStatus;
	position?: number;
	postponed?: { reason: 'sentinel_backlog' | 'instance_down'; backlog?: number; nextCheckAt: string };
	progress?: { written: number; total: number };
	result?: {
		contacts: number;
		reports: number;
		durationMs: number;
		usersDisabled?: number;
		usersUpdated?: number;
		accountsRestored?: number;
		loginsRecreated?: { username: string; previousUsername: string }[];
	};
	// a delete that has been undone: the restore job that did it
	undoneBy?: string;
	error?: { message: string; logTail: string[] };
	archive?: { available: boolean; docs: number; expiresAt: string };
	attempts: number;
	createdAt: string;
	updatedAt: string;
	finishedAt?: string;
};

// POST /preview with kind "merge"
export type MergePreview = {
	source: { id: string; name: string; location: string };
	destination: { id: string; name: string; location: string };
	counts: { places: number; people: number };
	large: boolean;
	properties: { name: string; label: string; source: string; destination: string }[];
	primaryContacts: { source: { id: string; name: string } | null; destination: { id: string; name: string } | null };
	accounts: { username: string; action: 'retire' | 'lose_place'; lastSync: string | null }[];
	lastSyncKnown: boolean;
	confirmName: string;
};

// POST /preview with kind "move"
export type MovePreview = {
	place: { id: string; name: string };
	from: string;
	to: string;
	alreadyThere: boolean;
	counts: { places: number; people: number };
	large: boolean;
	accounts: { username: string; lastSync: string | null }[];
	lastSyncKnown: boolean;
};

// POST /preview with kind "delete"
export type DeletePreview = {
	place: { id: string; name: string; location: string };
	counts: { places: number; people: number; reports: number };
	large: boolean;
	accounts: { username: string; places: string[]; action: 'retire' | 'lose_places'; lastSync: string | null }[];
	lastSyncKnown: boolean;
	confirmName: string;
};

// GET /hierarchy-jobs/{jobId}/undo
export type UndoPreview = {
	placeName: string;
	counts: { contacts: number; reports: number };
	parent: { id: string; name: string } | null;
	accounts: { username: string; places: string[]; disabled: boolean }[];
	archiveExpiresAt: string;
};
