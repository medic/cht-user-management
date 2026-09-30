import { randomInt } from 'node:crypto';

import { version } from '../../../../package.json';
import type { ContactType } from '../config';
import { ApiError, ChtError } from '../errors';
import { isRetryable, isUpdateConflict, type Cht, type CouchDoc, type NewUser, type UserInfo } from '../cht/client';
import { formatValue } from '../../validation/validators';
import type { Lineage } from '../../validation';

export const TOOL = `cht-user-management-web-${version}`;

// CHT's built-in hierarchy types are identified by `type`; configured ones use type "contact" + contact_type
const RESERVED_CONTACT_TYPES = ['district_hospital', 'health_center', 'clinic', 'person'];

export function contactAttributes(typeName: string): { type: string; contact_type?: string } {
	return RESERVED_CONTACT_TYPES.includes(typeName) ? { type: typeName } : { type: 'contact', contact_type: typeName };
}

export function docType(doc: CouchDoc): string | undefined {
	return doc.contact_type ?? doc.type;
}

// A test for people: CHT's `person` type, and every configured type CHT marks as a person, such as a
// household's members
export async function personCheck(cht: Cht): Promise<(doc: CouchDoc) => boolean> {
	const types = new Set(['person', ...(await cht.contactTypeSettings()).filter((type) => type.person).map((type) => type.id)]);
	return (doc) => doc.type === 'person' || types.has(docType(doc) ?? '');
}

export function contactRef(contact: unknown): string | undefined {
	if (typeof contact === 'string') {
		return contact;
	}
	return (contact as { _id?: string } | undefined)?._id;
}

// ids of the doc's parent, grandparent, ... read from CHT's minified `parent` chain
export function lineageIds(doc: CouchDoc): string[] {
	const ids: string[] = [];
	for (let parent = doc.parent; parent?._id; parent = parent.parent) {
		ids.push(parent._id);
	}
	return ids;
}

// the value CHT stores in a child's `parent` field: the parent id plus its own minified lineage
export function minifiedLineage(doc: CouchDoc): Record<string, unknown> {
	return doc.parent ? { _id: doc._id, parent: doc.parent } : { _id: doc._id };
}

export async function fetchDocs(cht: Cht, ids: string[]): Promise<(CouchDoc | null)[]> {
	return Promise.all(ids.map((id) => cht.getDoc(id)));
}

// `ancestors[0]` is the level-1 parent, `ancestors[1]` level 2, ...
export function lineageNames(contactType: ContactType, ancestors: (CouchDoc | null)[], replacedPlaceName?: string): Lineage {
	const names: Lineage = {};
	for (const level of contactType.hierarchy) {
		const name = ancestors[level.level - 1]?.name;
		if (name) {
			names[level.property_name] = formatValue(level, String(name));
		}
	}
	if (replacedPlaceName) {
		names.replacement = formatValue(contactType.replacement_property, replacedPlaceName);
	}
	return names;
}

export function withoutReplacement(lineage: Lineage): Record<string, string> {
	const { replacement: _replacement, ...rest } = lineage;
	return rest;
}

const CONFLICT_RETRIES = 6;

// Before retrying a document update conflict: growing, with jitter, so writers racing for the same
// doc don't collide again. About 3s in total over every retry.
export const conflictBackoff = { baseMs: 100 };
function afterConflict(attempt: number): Promise<void> {
	const ms = conflictBackoff.baseMs * 2 ** attempt * (0.5 + Math.random());
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// For read-modify-write updates: re-runs `update`, which reads afresh, when CHT reports a document
// update conflict
export async function retryOnConflict<T>(update: () => Promise<T>): Promise<T> {
	for (let attempt = 0; ; attempt++) {
		try {
			return await update();
		} catch (e) {
			if (!isUpdateConflict(e)) {
				throw e;
			}
			if (attempt + 1 >= CONFLICT_RETRIES) {
				throw conflictPersisted(e);
			}
			console.log(`document update conflict, retrying (${attempt + 1})`);
			await afterConflict(attempt);
		}
	}
}

function conflictPersisted(error: unknown): ApiError {
	return new ApiError(502, 'UPSTREAM_FAILED', `CHT kept reporting a document update conflict: ${(error as Error).message}. Sending the same request again resumes it.`, {
		chtStatus: (error as { status?: number }).status
	});
}

// attempts at creating a user, over every kind of failure together
const USER_ATTEMPTS = 8;

const PASSWORD_RETRY_MESSAGES = ['The password must be at least', 'The password is too easy to guess.'];

// Ported from lib/retry-logic.ts createUserWithRetries, with one change: before retrying after a
// failure that may have reached CHT, check whether the user now exists, so a retry never creates a
// second user for the same contact
export async function createUserWithRetries(
	cht: Cht,
	user: NewUser,
	regeneratePassword: () => string
): Promise<{ username: string; password: string }> {
	for (let attempt = 0; attempt < USER_ATTEMPTS; attempt++) {
		try {
			await cht.createUser(user);
			return { username: user.username, password: user.password };
		} catch (e) {
			if (!(e instanceof ChtError)) {
				throw e;
			}

			const conflict = isUpdateConflict(e);
			// the attempt may have reached CHT: an earlier try may have created the user
			const created = isRetryable(e) || conflict || e.message.includes('already taken.') ? await userForContact(cht, user.contact) : undefined;
			if (created) {
				return { username: created.username, password: user.password };
			}
			if (conflict) {
				if (attempt + 1 >= CONFLICT_RETRIES) {
					throw conflictPersisted(e);
				}
				console.log(`creating user ${user.username}: document update conflict, retrying (${attempt + 1})`);
				await afterConflict(attempt);
				continue;
			}
			if (isRetryable(e)) {
				continue;
			}
			if (e.status !== 400) {
				throw e;
			}
			if (e.message.includes('already taken.')) {
				user.username = `${user.username}${randomInt(0, 100)}`;
				continue;
			}
			if (PASSWORD_RETRY_MESSAGES.some((message) => e.message.includes(message))) {
				user.password = regeneratePassword();
				continue;
			}
			throw e;
		}
	}
	throw new ApiError(502, 'UPSTREAM_FAILED', `could not create a user for contact "${user.contact}"`);
}

// The contact's working account. A disabled one doesn't count: its login is gone.
export async function userForContact(cht: Cht, contactId: string): Promise<UserInfo | undefined> {
	const users = await cht.usersByContact(contactId);
	return users.find((user) => !user.inactive && (user.contactId === undefined || user.contactId === contactId));
}

// Adds any missing place ids to the user's assignment; returns true if CHT was updated. The
// update sends the whole place list, so after a conflict it's worked out again from a fresh read of
// the user: re-sending the old list could drop a place another write just added.
export async function ensureUserHasPlaces(cht: Cht, user: UserInfo, placeIds: string[]): Promise<boolean> {
	let current = user;
	let attempted = false;
	return retryOnConflict(async () => {
		if (attempted) {
			const reread = await userOfName(cht, current);
			if (!reread) {
				throw new ApiError(502, 'UPSTREAM_FAILED', `user "${current.username}" disappeared while its places were being updated`);
			}
			current = reread;
		}
		attempted = true;
		const missing = placeIds.filter((id) => !current.placeIds.includes(id));
		if (!missing.length) {
			// on a retry, the attempt that conflicted may have been applied after all
			return current !== user;
		}
		await cht.updateUser(current.username, { place: [...current.placeIds, ...missing] });
		return true;
	});
}

async function userOfName(cht: Cht, user: UserInfo): Promise<UserInfo | undefined> {
	const candidates = user.contactId ? await cht.usersByContact(user.contactId) : await cht.usersAtPlace(user.placeIds[0] ?? '');
	return candidates.find((candidate) => candidate.username === user.username);
}
