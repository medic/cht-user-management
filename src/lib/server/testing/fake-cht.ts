import { ChtError } from '../errors';
import type { Cht, CouchDoc, NewUser, UserInfo } from '../cht/client';

type StoredUser = { username: string; password: string; place: string[]; contact: string; roles: string[]; inactive?: boolean };
type Method = keyof Cht;

// In-memory stand-in for a CHT instance, with enough CouchDB behaviour (revs, 409s) to exercise retries
export class FakeCht implements Cht {
	readonly domain = 'fake.cht';
	readonly docs = new Map<string, CouchDoc>();
	readonly users = new Map<string, StoredUser>();
	readonly calls: Method[] = [];
	private failures: { method: Method; error: ChtError; afterSuccess: boolean }[] = [];
	private revCounter = 0;

	seed(...docs: CouchDoc[]): this {
		for (const doc of docs) {
			this.docs.set(doc._id, { ...structuredClone(doc), _rev: `1-${++this.revCounter}` });
		}
		return this;
	}

	seedUser(user: Omit<StoredUser, 'password'>): this {
		this.users.set(user.username, { password: 'seeded', ...user });
		return this;
	}

	// The next call to `method` throws. With afterSuccess the call takes effect first, like a timeout
	// after CHT already applied the write.
	failNext(method: Method, error: ChtError, options: { afterSuccess?: boolean } = {}): this {
		this.failures.push({ method, error, afterSuccess: !!options.afterSuccess });
		return this;
	}

	async getDoc(id: string): Promise<CouchDoc | null> {
		await this.enter('getDoc');
		const doc = this.docs.get(id);
		return doc ? structuredClone(doc) : null;
	}

	async getDocs(ids: string[], _options?: { attachments?: boolean }): Promise<CouchDoc[]> {
		await this.enter('getDocs');
		return ids.map((id) => this.docs.get(id)).filter((doc): doc is CouchDoc => !!doc).map((doc) => structuredClone(doc));
	}

	async putDoc(doc: CouchDoc): Promise<string> {
		return this.run('putDoc', () => {
			const existing = this.docs.get(doc._id);
			if ((existing && existing._rev !== doc._rev) || (!existing && doc._rev)) {
				throw new ChtError(409, 'Document update conflict.');
			}
			const rev = `${Number(existing?._rev?.split('-')[0] ?? 0) + 1}-${++this.revCounter}`;
			this.docs.set(doc._id, { ...structuredClone(doc), _rev: rev });
			return rev;
		});
	}

	async deleteDoc(id: string, rev: string): Promise<void> {
		return this.run('deleteDoc', () => {
			const existing = this.docs.get(id);
			if (!existing) {
				throw new ChtError(404, 'missing');
			}
			if (existing._rev !== rev) {
				throw new ChtError(409, 'Document update conflict.');
			}
			this.docs.delete(id);
		});
	}

	async placesOfType(type: string): Promise<CouchDoc[]> {
		await this.enter('placesOfType');
		return [...this.docs.values()].filter((doc) => (doc.contact_type ?? doc.type) === type).map((doc) => structuredClone(doc));
	}

	async countPlacesOfType(type: string, upTo: number): Promise<number> {
		await this.enter('countPlacesOfType');
		return Math.min(upTo, [...this.docs.values()].filter((doc) => (doc.contact_type ?? doc.type) === type).length);
	}

	// like contacts_by_depth: a doc is found under every ancestor in its lineage, even once the ancestor
	// itself is gone
	async docsAtDepth(parentId: string, depths: number[]): Promise<CouchDoc[]> {
		await this.enter('docsAtDepth');
		const result: CouchDoc[] = [];
		for (const doc of this.docs.values()) {
			if (doc.type === 'data_record') continue;
			let depth = doc._id === parentId ? 0 : undefined;
			for (let parent = doc.parent, level = 1; depth === undefined && parent?._id; parent = parent.parent, level++) {
				if (parent._id === parentId) depth = level;
			}
			if (depth !== undefined && depths.includes(depth)) result.push(structuredClone(doc));
		}
		return result;
	}

	sentinel = 0;
	readonly syncs = new Map<string, string>();

	async sentinelBacklog(): Promise<number> {
		await this.enter('sentinelBacklog');
		return this.sentinel;
	}

	async lastSyncs(usernames: string[]): Promise<Map<string, string | null>> {
		await this.enter('lastSyncs');
		return new Map(usernames.map((username) => [username, this.syncs.get(username) ?? null]));
	}

	// what CHT's app settings allow as parents, as in the Kenya config
	contactTypes = [
		{ id: 'a_county', parents: [], person: false },
		{ id: 'b_sub_county', parents: ['a_county'], person: false },
		{ id: 'c_community_health_unit', parents: ['b_sub_county'], person: false },
		{ id: 'd_community_health_volunteer_area', parents: ['c_community_health_unit'], person: false },
		{ id: 'e_household', parents: ['d_community_health_volunteer_area'], person: false },
		{ id: 'person', parents: ['a_county', 'b_sub_county', 'c_community_health_unit', 'd_community_health_volunteer_area'], person: true },
		{ id: 'f_client', parents: ['e_household'], person: true }
	];

	async contactTypeSettings() {
		await this.enter('contactTypeSettings');
		return structuredClone(this.contactTypes);
	}

	async countReportsAbout(contactIds: string[]): Promise<number> {
		await this.enter('countReportsAbout');
		const subjects = ['patient_id', 'patient_uuid', 'place_id', 'place_uuid'];
		return [...this.docs.values()].filter(
			(doc) => doc.type === 'data_record' && subjects.some((key) => contactIds.includes(doc[key]) || contactIds.includes(doc.fields?.[key]))
		).length;
	}

	async usersByContact(contactId: string): Promise<UserInfo[]> {
		await this.enter('usersByContact');
		return [...this.users.values()].filter((user) => user.contact === contactId).map(toInfo);
	}

	async usersAtPlace(placeId: string): Promise<UserInfo[]> {
		await this.enter('usersAtPlace');
		return [...this.users.values()].filter((user) => user.place.includes(placeId)).map(toInfo);
	}

	async createUser(user: NewUser): Promise<void> {
		return this.run('createUser', () => {
			if (this.users.has(user.username)) {
				throw new ChtError(400, `Username "${user.username}" already taken.`);
			}
			this.users.set(user.username, {
				username: user.username,
				password: user.password,
				place: [...user.place],
				contact: user.contact,
				roles: [...user.roles]
			});
		});
	}

	async updateUser(username: string, patch: { place?: string[]; roles?: string[] }): Promise<void> {
		return this.run('updateUser', () => {
			const user = this.users.get(username);
			if (!user) {
				throw new ChtError(404, `user "${username}" not found`);
			}
			if (patch.place) {
				user.place = [...patch.place];
			}
			if (patch.roles) {
				user.roles = [...patch.roles];
			}
		});
	}

	async disableUser(username: string): Promise<void> {
		return this.run('disableUser', () => {
			const user = this.users.get(username);
			if (!user) {
				throw new ChtError(404, `user "${username}" not found`);
			}
			user.inactive = true;
		});
	}

	private async enter(method: Method): Promise<void> {
		this.calls.push(method);
		const index = this.failures.findIndex((failure) => failure.method === method && !failure.afterSuccess);
		if (index >= 0) {
			const [failure] = this.failures.splice(index, 1);
			throw failure.error;
		}
	}

	private async run<T>(method: Method, apply: () => T): Promise<T> {
		await this.enter(method);
		const result = apply();
		const index = this.failures.findIndex((failure) => failure.method === method && failure.afterSuccess);
		if (index >= 0) {
			const [failure] = this.failures.splice(index, 1);
			throw failure.error;
		}
		return result;
	}
}

function toInfo(user: StoredUser): UserInfo {
	return { username: user.username, placeIds: [...user.place], contactId: user.contact, roles: [...user.roles], inactive: user.inactive };
}
