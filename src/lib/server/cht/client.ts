import { ChtError } from '../errors';

export type CouchDoc = { _id: string; _rev?: string; [key: string]: any };

export type UserInfo = {
	username: string;
	placeIds: string[];
	contactId?: string;
	roles: string[];
	inactive?: boolean;
};

export type NewUser = {
	username: string;
	password: string;
	roles: string[];
	place: string[];
	contact: string;
	fullname?: string;
	phone?: string;
	password_change_required: boolean;
};

export interface Cht {
	readonly domain: string;
	getDoc(id: string): Promise<CouchDoc | null>;
	// several docs in one request; missing ones are left out
	// with attachments: their data inline, as base64, rather than stubs
	getDocs(ids: string[], options?: { attachments?: boolean }): Promise<CouchDoc[]>;
	// returns the new rev; throws ChtError(409) on an update conflict
	putDoc(doc: CouchDoc): Promise<string>;
	deleteDoc(id: string, rev: string): Promise<void>;
	placesOfType(type: string): Promise<CouchDoc[]>;
	docsAtDepth(parentId: string, depths: number[]): Promise<CouchDoc[]>;
	usersByContact(contactId: string): Promise<UserInfo[]>;
	usersAtPlace(placeId: string): Promise<UserInfo[]>;
	createUser(user: NewUser): Promise<void>;
	updateUser(username: string, patch: { place?: string[]; roles?: string[] }): Promise<void>;
	disableUser(username: string): Promise<void>;
	// how many changes CHT's Sentinel still has to process (GET api/v2/monitoring)
	sentinelBacklog(): Promise<number>;
	// each account's last sync, from its connected-user doc; readable by admins only, so null for
	// others and for accounts that never synced
	lastSyncs(usernames: string[]): Promise<Map<string, string | null>>;
	// how many reports have one of these contacts as their subject (medic-client/reports_by_subject)
	countReportsAbout(contactIds: string[]): Promise<number>;
	// the contact types in CHT's app settings, with the parents each may have
	contactTypeSettings(): Promise<{ id: string; parents: string[]; person: boolean }[]>;
}

export type ChtConnection = {
	domain: string;
	useHttp?: boolean;
	// the CouchDB "AuthSession=..." cookie of the logged-in user
	sessionCookie: string;
};

// same as legacy lib/retry-logic.ts axiosRetryConfig
const RETRYABLE_STATUS = [500, 502, 503, 504, 511];
const RETRY_COUNT = 4;
const RETRY_DELAY_MS = 1000;

// Never retried blindly, since re-sending the same body can undo another write: callers retry
// conflicts from a fresh read (isUpdateConflict)
export function isRetryable(error: unknown): boolean {
	return error instanceof ChtError && !isUpdateConflict(error) && (error.status === undefined || RETRYABLE_STATUS.includes(error.status));
}

// CouchDB's "Document update conflict": the doc changed between being read and written. CHT's API
// passes it on as a 409, and sometimes as a 500 carrying the same message.
export function isUpdateConflict(error: unknown): boolean {
	if (!(error instanceof ChtError)) {
		return false;
	}
	const body = error.body as { error?: unknown } | undefined;
	return error.status === 409 || body?.error === 'conflict' || /document update conflict/i.test(error.message);
}

export class HttpCht implements Cht {
	readonly domain: string;
	private readonly baseUrl: string;

	constructor(private readonly connection: ChtConnection) {
		this.domain = connection.domain;
		this.baseUrl = `${connection.useHttp ? 'http' : 'https'}://${connection.domain}/`;
	}

	async getDoc(id: string): Promise<CouchDoc | null> {
		try {
			return await this.request('GET', `medic/${encodeURIComponent(id)}`);
		} catch (e) {
			if (e instanceof ChtError && e.status === 404) {
				return null;
			}
			throw e;
		}
	}

	async getDocs(ids: string[], options: { attachments?: boolean } = {}): Promise<CouchDoc[]> {
		if (!ids.length) {
			return [];
		}
		const query: Record<string, string> = { include_docs: 'true', ...(options.attachments ? { attachments: 'true' } : {}) };
		const result = await this.request('POST', 'medic/_all_docs', { query, body: { keys: ids } });
		return (result.rows ?? []).map((row: any) => row.doc).filter(Boolean);
	}

	async putDoc(doc: CouchDoc): Promise<string> {
		const result = await this.request('PUT', `medic/${encodeURIComponent(doc._id)}`, { body: doc });
		return result.rev;
	}

	async deleteDoc(id: string, rev: string): Promise<void> {
		await this.request('DELETE', `medic/${encodeURIComponent(id)}`, { query: { rev } });
	}

	async placesOfType(type: string): Promise<CouchDoc[]> {
		const result = await this.request('GET', 'medic/_design/medic-client/_view/contacts_by_type', {
			query: { key: JSON.stringify([type]), include_docs: 'true', reduce: 'false' }
		});
		return result.rows.map((row: any) => row.doc);
	}

	async docsAtDepth(parentId: string, depths: number[]): Promise<CouchDoc[]> {
		const result = await this.request('GET', 'medic/_design/medic/_view/contacts_by_depth', {
			query: { keys: JSON.stringify(depths.map((depth) => [parentId, depth])), include_docs: 'true' }
		});
		return (result.rows ?? []).map((row: any) => row.doc).filter(Boolean);
	}

	async usersByContact(contactId: string): Promise<UserInfo[]> {
		const result = await this.request('GET', 'api/v2/users', { query: { contact_id: contactId } });
		return (result ?? []).map(toUserInfo);
	}

	async usersAtPlace(placeId: string): Promise<UserInfo[]> {
		const result = await this.request('GET', 'api/v2/users', { query: { facility_id: placeId } });
		return (result ?? []).map(toUserInfo);
	}

	async createUser(user: NewUser): Promise<void> {
		// callers handle retries: a blind retry here could create the user twice
		await this.request('POST', 'api/v3/users', { body: user, retries: 0 });
	}

	async updateUser(username: string, patch: { place?: string[]; roles?: string[] }): Promise<void> {
		await this.request('POST', `api/v1/users/${encodeURIComponent(username)}`, { body: { username, ...patch } });
	}

	async disableUser(username: string): Promise<void> {
		await this.request('DELETE', `api/v1/users/${encodeURIComponent(username)}`);
	}

	async sentinelBacklog(): Promise<number> {
		const result = await this.request('GET', 'api/v2/monitoring');
		return Number(result?.sentinel?.backlog ?? 0);
	}

	async lastSyncs(usernames: string[]): Promise<Map<string, string | null>> {
		const syncs = new Map<string, string | null>(usernames.map((username) => [username, null]));
		if (!usernames.length) {
			return syncs;
		}
		const result = await this.request('POST', 'medic-logs/_all_docs', {
			query: { include_docs: 'true' },
			body: { keys: usernames.map((username) => `connected-user-${username}`) }
		});
		for (const row of result.rows ?? []) {
			const timestamp = row.doc?.timestamp;
			if (row.doc?.user && timestamp) syncs.set(row.doc.user, new Date(timestamp).toISOString());
		}
		return syncs;
	}

	async contactTypeSettings(): Promise<{ id: string; parents: string[]; person: boolean }[]> {
		const settings = await this.request('GET', 'api/v1/settings');
		return (settings?.contact_types ?? []).map((type: any) => ({ id: type.id, parents: type.parents ?? [], person: !!type.person }));
	}

	async countReportsAbout(contactIds: string[]): Promise<number> {
		const reports = new Set<string>();
		for (let start = 0; start < contactIds.length; start += 100) {
			const result = await this.request('POST', 'medic/_design/medic-client/_view/reports_by_subject', {
				body: { keys: contactIds.slice(start, start + 100) }
			});
			for (const row of result.rows ?? []) reports.add(row.id);
		}
		return reports.size;
	}

	private async request(
		method: string,
		path: string,
		options: { body?: unknown; query?: Record<string, string>; retries?: number } = {}
	): Promise<any> {
		const url = new URL(path, this.baseUrl);
		for (const [key, value] of Object.entries(options.query ?? {})) {
			url.searchParams.set(key, value);
		}

		const retries = options.retries ?? RETRY_COUNT;
		for (let attempt = 0; ; attempt++) {
			try {
				return await this.send(method, url, options.body);
			} catch (e) {
				if (attempt >= retries || !isRetryable(e)) {
					throw e;
				}
				console.log(`${method} ${url.pathname} failed (${(e as ChtError).status ?? '?'}), retrying (${attempt + 1})`);
				await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
			}
		}
	}

	private async send(method: string, url: URL, body: unknown): Promise<any> {
		let response: Response;
		try {
			response = await fetch(url, {
				method,
				headers: {
					Cookie: this.connection.sessionCookie,
					Accept: 'application/json',
					...(body === undefined ? {} : { 'Content-Type': 'application/json' })
				},
				body: body === undefined ? undefined : JSON.stringify(body)
			});
		} catch (e) {
			throw new ChtError(undefined, `could not reach ${this.domain}: ${e}`);
		}

		const text = await response.text();
		const parsed = parseBody(text);
		if (!response.ok) {
			throw new ChtError(response.status, errorMessage(parsed) ?? `${method} ${url.pathname} failed with ${response.status}`, parsed);
		}
		return parsed;
	}
}

function parseBody(text: string): unknown {
	if (!text) {
		return undefined;
	}
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

// CHT reports errors as a string, { error: string }, { error: { message } } or { message } depending on the endpoint
function errorMessage(body: any): string | undefined {
	if (typeof body === 'string') {
		return body;
	}
	const message = body?.error?.message ?? body?.error ?? body?.message ?? body?.reason;
	return typeof message === 'string' ? message : undefined;
}

// api/v2/users returns `place` and `contact` as ids, docs, or arrays of either
function toUserInfo(user: any): UserInfo {
	const places = Array.isArray(user.place) ? user.place : [user.place];
	return {
		username: user.username,
		placeIds: places.map((place: any) => (typeof place === 'string' ? place : place?._id)).filter(Boolean),
		contactId: typeof user.contact === 'string' ? user.contact : user.contact?._id,
		roles: user.roles ?? [],
		inactive: user.inactive
	};
}
