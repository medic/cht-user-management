import { assertAuthorized } from '../auth/session';
import { getContactType, mutate, type ContactType, type PlaceDraft } from '../config';
import { ApiError, isChtStatus } from '../errors';
import type { Cht, CouchDoc, NewUser, UserInfo } from '../cht/client';
import { buildProperties, resolveRoles, type Lineage, type ValidationErrors } from '../../validation';
import { generatePassword, sanitizeUsername } from '../username';
import type { OperationContext, OperationResult } from './context';
import type { ReplaceRequest } from './schemas';
import { putNew, validationFailed } from './create';
import { recallPassword, recordCredentials } from './credentials';
import { isWithinFacilities } from './directory';
import {
	TOOL,
	contactAttributes,
	contactRef,
	createUserWithRetries,
	docType,
	ensureUserHasPlaces,
	lineageIds,
	lineageNames,
	minifiedLineage,
	retryOnConflict,
	userForContact,
	withoutReplacement
} from './documents';

// APP.md → Replace Existing Users. One operation for every handover: a new or an existing person,
// taking over all the outgoing person's places or just this one.

export type ReplaceResult = {
	outcome: 'replaced' | 'already_applied';
	placeId: string;
	contactId: string;
	previousContactId: string | null;
	// every place handed over by this request
	affectedPlaceIds: string[];
	// outgoing accounts left with no places, now retired
	retiredUsers: string[];
	username: string;
	// every place the incoming account now holds
	places: string[];
	// new person only; null on a repeat once the credentials record has expired
	password?: string | null;
};

// Appended to the place's user_attribution.replacements when it's switched (step 7). It records the
// outgoing situation, so a repeat can finish the clean-up after the outgoing accounts are gone.
export type ReplacementEntry = {
	contact: string;
	previous_contact: string | null;
	scope: 'all' | 'place';
	affected_places: string[];
	outgoing_users: string[];
	tool: string;
	username: string;
	replaced_time: number;
};

export const DEACTIVATED_ROLE = 'deactivated';

export type PersonNotEligible = 'NO_ACCOUNT' | 'SEVERAL_ACCOUNTS' | 'NO_ACTIVE_ACCOUNT' | 'MISSING_ROLE';

// Whether an existing person can take over places of this type with their account (APP.md step 3)
export function eligibility(contactType: ContactType, accounts: UserInfo[]): { account?: UserInfo; reason?: PersonNotEligible } {
	if (!accounts.length) return { reason: 'NO_ACCOUNT' };
	if (accounts.length > 1) return { reason: 'SEVERAL_ACCOUNTS' };
	const [account] = accounts;
	if (account.inactive) return { account, reason: 'NO_ACTIVE_ACCOUNT' };
	if (!account.roles.some((role) => contactType.user_role.includes(role))) return { account, reason: 'MISSING_ROLE' };
	return { account };
}

const NOT_ELIGIBLE_MESSAGES: Record<PersonNotEligible, (name: string, username?: string) => string> = {
	NO_ACCOUNT: (name) => `${name} has no active account to take over with`,
	SEVERAL_ACCOUNTS: (name) => `${name} has several accounts, so it isn't clear which one takes over`,
	NO_ACTIVE_ACCOUNT: (name) => `${name} has no active account to take over with`,
	MISSING_ROLE: (_name, username) => `${username} doesn't have the roles needed for this type`
};

export type Incoming =
	| { kind: 'new'; doc: CouchDoc | null }
	| { kind: 'existing'; doc: CouchDoc; account: UserInfo };

export type PreparedReplace = Awaited<ReturnType<typeof prepareReplace>>;

// Steps 1–5: every check, and where things stand, without writing. The staged list runs it when an
// item is added; the replace itself runs it again first.
export async function prepareReplace(context: OperationContext, placeId: string, request: ReplaceRequest) {
	const { cht, session } = context;
	const contactType = getContactType(request.contactType, 'replace');
	const contactId = request.contact.id;
	const isNewPerson = request.contact.properties !== undefined;
	if (contactId === placeId) {
		throw validationFailed({ 'contact.id': 'must differ from the place id' });
	}
	if (!isNewPerson && !contactType.can_assign_multiple) {
		throw new ApiError(422, 'EXISTING_PERSON_NOT_ALLOWED', `${contactType.friendly} places can only be taken over by a new person`);
	}

	// 2. the place
	const placeDoc = await cht.getDoc(placeId);
	if (!placeDoc) {
		throw new ApiError(404, 'PLACE_NOT_FOUND', `place "${placeId}" was not found`);
	}
	if (docType(placeDoc) !== contactType.name) {
		throw new ApiError(422, 'PLACE_WRONG_TYPE', `place "${placeId}" is a "${docType(placeDoc)}", not a "${contactType.name}"`);
	}
	assertAuthorized(session, [placeId, ...lineageIds(placeDoc)]);

	// 3. the incoming person
	const personDoc = await cht.getDoc(contactId);
	let incoming: Incoming;
	if (isNewPerson) {
		if (personDoc && (docType(personDoc) !== contactType.contact_type || personDoc.parent?._id !== placeId)) {
			throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', `"${contactId}" already exists and isn't a new person for "${placeDoc.name}"`);
		}
		incoming = { kind: 'new', doc: personDoc };
	} else {
		if (!personDoc || docType(personDoc) !== contactType.contact_type) {
			throw new ApiError(404, 'PERSON_NOT_FOUND', `person "${contactId}" was not found`);
		}
		if (!isWithinFacilities(session, personDoc)) {
			throw new ApiError(403, 'FORBIDDEN_PLACE', 'you are not allowed to manage places in this part of the hierarchy');
		}
		const { account, reason } = eligibility(contactType, await cht.usersByContact(contactId));
		if (reason || !account) {
			const name = String(personDoc.name ?? contactId);
			throw new ApiError(422, 'PERSON_NOT_ELIGIBLE', NOT_ELIGIBLE_MESSAGES[reason!](name, account?.username), { reason });
		}
		incoming = { kind: 'existing', doc: personDoc, account };
	}

	// 1. validate, now that the incoming person's values are known for generated properties
	const fetched = await cht.getDocs(lineageIds(placeDoc));
	const byId = new Map(fetched.map((doc) => [doc._id, doc]));
	// parent first
	const ancestors = lineageIds(placeDoc).map((id) => byId.get(id) ?? null);
	const lineage = lineageNames(contactType, ancestors, String(placeDoc.name ?? ''));
	const built = buildProperties({
		contactType,
		mode: 'replace',
		place: request.place,
		contact: isNewPerson ? request.contact.properties : undefined,
		existingPlace: placeDoc,
		existingContact: incoming.kind === 'existing' ? incoming.doc : undefined,
		lineage
	});
	const errors: ValidationErrors = { ...built.errors };
	const roles = isNewPerson ? resolveRoles(contactType, request.user?.roles) : { roles: [] as string[] };
	if ('error' in roles && roles.error) errors['user.roles'] = roles.error;
	if (!isNewPerson && request.user) errors['user.roles'] = 'Only a new person gets roles; an existing person keeps their own';
	if (Object.keys(errors).length) {
		throw validationFailed(errors);
	}

	// 4. where things stand
	const currentContactId = contactRef(placeDoc.contact);
	const history = placeDoc.user_attribution ?? {};
	const entry: ReplacementEntry | undefined = (history.replacements ?? []).find((r: ReplacementEntry) => r.contact === contactId);
	let state: 'fresh' | 'switched' | 'nothing_to_do' = 'fresh';
	if (currentContactId === contactId) {
		if (entry) {
			state = 'switched';
		} else if (incoming.kind === 'existing' && incoming.account.placeIds.includes(placeId)) {
			state = 'nothing_to_do';
		} else {
			throw new ApiError(409, 'ALREADY_PRIMARY', `${personDoc?.name ?? contactId} is already the primary contact of ${placeDoc.name}`);
		}
	} else if (entry || (history.previousPrimaryContacts ?? []).includes(contactId)) {
		throw new ApiError(409, 'SUPERSEDED', `${placeDoc.name} has been replaced again since; nothing changed`);
	}

	// 5. the outgoing situation: recorded on the place in step 7, read back from there on a repeat
	let outgoing: { contactId: string | null; doc: CouchDoc | null; accounts: UserInfo[]; otherPlaceIds: string[] };
	if (state === 'fresh') {
		const outgoingId = currentContactId ?? null;
		const [outgoingDoc, accounts] = outgoingId ? await Promise.all([cht.getDoc(outgoingId), cht.usersByContact(outgoingId)]) : [null, []];
		const otherPlaceIds = [...new Set(accounts.flatMap((account) => account.placeIds))].filter((id) => id !== placeId);
		outgoing = { contactId: outgoingId, doc: outgoingDoc, accounts, otherPlaceIds };
	} else {
		const previous = entry?.previous_contact ?? null;
		outgoing = { contactId: previous, doc: previous ? await cht.getDoc(previous) : null, accounts: [], otherPlaceIds: entry?.affected_places ?? [] };
	}
	const scope = contactType.can_assign_multiple ? request.scope : 'all';
	const affectedPlaceIds = state === 'fresh' ? (scope === 'all' ? outgoing.otherPlaceIds : []) : (entry?.affected_places ?? []);

	return { contactType, contactId, placeDoc, ancestors, lineage, built, roles: roles.roles, incoming, state, entry, outgoing, scope, affectedPlaceIds };
}

// PUT /api/v1/places/{placeId}/primary-contact. Every step checks what's already done, so a repeat
// resumes an interrupted attempt and replays a finished one.
export async function replacePrimaryContact(context: OperationContext, placeId: string, request: ReplaceRequest): Promise<OperationResult<ReplaceResult>> {
	const { cht, session } = context;
	const prepared = await prepareReplace(context, placeId, request);
	const { contactType, contactId, placeDoc, lineage, built, incoming, scope } = prepared;
	const now = Date.now();
	let changed = false;

	if (prepared.state === 'nothing_to_do') {
		const account = (incoming as Extract<Incoming, { kind: 'existing' }>).account;
		return {
			status: 200,
			body: {
				outcome: 'already_applied',
				placeId,
				contactId,
				previousContactId: null,
				affectedPlaceIds: [],
				retiredUsers: [],
				username: account.username,
				places: account.placeIds
			}
		};
	}

	// 6. the new person, under the place
	if (incoming.kind === 'new' && !incoming.doc) {
		const personDoc: CouchDoc = {
			...built.contact,
			...contactAttributes(contactType.contact_type),
			_id: contactId,
			parent: minifiedLineage(placeDoc),
			reported_date: now,
			user_attribution: { tool: TOOL, username: session.username, created_time: now, replacement: placeDoc.name }
		};
		await putNew(cht, personDoc, (doc) => docType(doc) === contactType.contact_type && doc.parent?._id === placeId);
		changed = true;
	}
	// a new person hangs under this place; an existing one keeps their own lineage
	const incomingRef = { _id: contactId, parent: incoming.kind === 'new' ? minifiedLineage(placeDoc) : incoming.doc.parent };

	// 7. switch the place, recording the outgoing situation
	let entry = prepared.entry;
	if (prepared.state === 'fresh') {
		const outgoingId = prepared.outgoing.contactId;
		entry = await switchPlace(cht, contactType, placeId, outgoingId, incomingRef, built.place, {
			contact: contactId,
			previous_contact: outgoingId,
			scope,
			affected_places: prepared.affectedPlaceIds,
			outgoing_users: prepared.outgoing.accounts.map((account) => account.username),
			tool: TOOL,
			username: session.username,
			replaced_time: now
		});
		changed = true;
	}
	const recorded = entry!;
	const previousContactId = recorded.previous_contact;

	// 8. the other places, each only while it still points at the outgoing person
	const handedOver = [placeId];
	for (const otherId of recorded.affected_places) {
		const result = await switchOtherPlace(cht, contactType, otherId, previousContactId, incomingRef, incoming.kind === 'new' ? built.contact : incoming.doc);
		changed ||= result === 'switched';
		if (result !== 'left_alone') handedOver.push(otherId);
	}

	// 9. a login for the places, before anything is taken from the outgoing accounts
	const contactValues: Record<string, unknown> = incoming.kind === 'new' ? (incoming.doc ?? built.contact) : incoming.doc;
	let username: string;
	let places: string[];
	let password: string | null | undefined;
	let newCredentials = false;
	const existingUser = incoming.kind === 'existing' ? incoming.account : await userForContact(cht, contactId);
	if (existingUser) {
		changed = (await ensureUserHasPlaces(cht, existingUser, handedOver)) || changed;
		username = existingUser.username;
		places = [...new Set([...existingUser.placeIds, ...handedOver])];
		if (incoming.kind === 'new') password = await recallPassword(context.uploadLog, session.username, contactId);
	} else {
		const usernameSource = contactType.username_from_place ? (built.place.name ?? placeDoc.name) : contactValues.name;
		const user: NewUser = {
			username: sanitizeUsername(String(usernameSource ?? '')),
			password: generatePassword(),
			roles: prepared.roles,
			place: handedOver,
			contact: contactId,
			fullname: String(contactValues.name ?? ''),
			phone: String(contactValues.phone ?? ''),
			password_change_required: contactValues.require_password_change === 'yes'
		};
		({ username, password } = await createUserWithRetries(cht, user, generatePassword));
		places = handedOver;
		newCredentials = true;
		changed = true;
	}

	// 10. take the places from the outgoing accounts; an account left with none is retired
	const retired = await takeFromOutgoing(cht, contactType, previousContactId, recorded.outgoing_users, handedOver);
	changed ||= retired.changed;

	// The outgoing person is never deleted: they stay under their place, with their reports and the
	// place's history (APP.md → Replace Existing Users)

	// 11. the credentials, for a new person
	if (newCredentials && password) {
		await recordCredentials(context.uploadLog, session.username, {
			place: String(built.place.name ?? placeDoc.name ?? ''),
			person: String(contactValues.name ?? ''),
			phone: String(contactValues.phone ?? ''),
			contactType: contactType.name,
			credentials: { username, password, placeId, contactId, created_at: now },
			hierarchy: withoutReplacement(lineage)
		});
	}

	return {
		status: changed ? 201 : 200,
		body: {
			outcome: changed ? 'replaced' : 'already_applied',
			placeId,
			contactId,
			previousContactId,
			affectedPlaceIds: handedOver,
			retiredUsers: retired.usernames,
			username,
			places,
			...(incoming.kind === 'new' ? { password: password ?? null } : {})
		}
	};
}

// Step 7: a read-modify-write of the place, adding to user_attribution and never overwriting it
async function switchPlace(
	cht: Cht,
	contactType: ContactType,
	placeId: string,
	expectedContact: string | null,
	incomingRef: Record<string, unknown>,
	placeValues: Record<string, string>,
	newEntry: ReplacementEntry
): Promise<ReplacementEntry> {
	return retryOnConflict(async () => {
		const doc = await cht.getDoc(placeId);
		if (!doc) {
			throw new ApiError(404, 'PLACE_NOT_FOUND', `place "${placeId}" was not found`);
		}
		const current = contactRef(doc.contact) ?? null;
		const recorded = (doc.user_attribution?.replacements ?? []).find((r: ReplacementEntry) => r.contact === newEntry.contact);
		if (current === newEntry.contact && recorded) {
			// an identical request switched it first
			return recorded;
		}
		if (current !== expectedContact) {
			throw new ApiError(409, 'CONCURRENT_MODIFICATION', 'the place changed while being replaced; review and try again');
		}

		const draft: PlaceDraft = { ...placeValues, contact_type: contactType.name, parent: doc.parent?._id };
		await mutate(draft, { cht, contactType, isReplacement: true });
		const { contact_type: _contactType, parent: _parent, ...fields } = draft;
		Object.assign(doc, fields);

		const attribution = doc.user_attribution ?? {};
		attribution.previousPrimaryContacts = [...(attribution.previousPrimaryContacts ?? []), ...(current ? [current] : [])];
		attribution.replacements = [...(attribution.replacements ?? []), newEntry];
		doc.user_attribution = attribution;
		doc.contact = incomingRef;
		await cht.putDoc(doc);
		return newEntry;
	});
}

// Step 8: another place of the outgoing person's switches the same way, with its generated
// properties recomputed for the incoming person. A place someone has since changed is left alone.
async function switchOtherPlace(
	cht: Cht,
	contactType: ContactType,
	placeId: string,
	outgoingId: string | null,
	incomingRef: { _id: string },
	incomingValues: Record<string, unknown>
): Promise<'switched' | 'already' | 'left_alone'> {
	return retryOnConflict(async () => {
		const doc = await cht.getDoc(placeId);
		const current = doc ? contactRef(doc.contact) : undefined;
		if (!doc || current === incomingRef._id) {
			return doc ? 'already' : 'left_alone';
		}
		if (!outgoingId || current !== outgoingId) {
			return 'left_alone';
		}

		const ancestors = await cht.getDocs(lineageIds(doc));
		const byId = new Map(ancestors.map((ancestor) => [ancestor._id, ancestor]));
		const lineage: Lineage = lineageNames(contactType, lineageIds(doc).map((id) => byId.get(id) ?? null), String(doc.name ?? ''));
		const regenerated = buildProperties({ contactType, mode: 'replace', place: {}, existingPlace: doc, existingContact: incomingValues, lineage });
		if (docType(doc) === contactType.name) Object.assign(doc, regenerated.place);

		const attribution = doc.user_attribution ?? {};
		attribution.previousPrimaryContacts = [...(attribution.previousPrimaryContacts ?? []), outgoingId];
		doc.user_attribution = attribution;
		doc.contact = incomingRef;
		await cht.putDoc(doc);
		return 'switched';
	});
}

// Step 10. Only the accounts recorded as the outgoing person's, and only if they still hold the
// places; other accounts assigned to the places are left alone. `all`: every outgoing account is
// now retired, so the outgoing person serves nothing through them.
async function takeFromOutgoing(
	cht: Cht,
	contactType: ContactType,
	outgoingId: string | null,
	outgoingUsers: string[],
	handedOver: string[]
): Promise<{ usernames: string[]; all: boolean; changed: boolean }> {
	const accounts = outgoingId ? (await cht.usersByContact(outgoingId)).filter((account) => outgoingUsers.includes(account.username)) : [];
	const retired: string[] = [];
	let changed = false;
	for (const recorded of outgoingUsers) {
		const account = accounts.find((a) => a.username === recorded);
		// gone, or already disabled: nothing left to take
		if (!account || account.inactive) {
			retired.push(recorded);
			continue;
		}
		const remaining = account.placeIds.filter((id) => !handedOver.includes(id));
		if (remaining.length) {
			if (remaining.length !== account.placeIds.length) {
				changed = (await removePlaces(cht, account, handedOver)) || changed;
			}
			continue;
		}
		retired.push(account.username);
		if (contactType.deactivate_users_on_replace) {
			if (!(account.roles.length === 1 && account.roles[0] === DEACTIVATED_ROLE)) {
				await cht.updateUser(account.username, { roles: [DEACTIVATED_ROLE] });
				changed = true;
			}
		} else {
			try {
				await cht.disableUser(account.username);
				changed = true;
			} catch (e) {
				if (!isChtStatus(e, 404)) throw e;
			}
		}
	}
	return { usernames: retired, all: retired.length === outgoingUsers.length, changed };
}

// The place list is sent whole, so a conflict is retried from a fresh read of the account
async function removePlaces(cht: Cht, account: UserInfo, placeIds: string[]): Promise<boolean> {
	let current = account;
	let first = true;
	return retryOnConflict(async () => {
		if (!first) {
			current = (await cht.usersByContact(account.contactId ?? '')).find((a) => a.username === account.username) ?? current;
		}
		first = false;
		const remaining = current.placeIds.filter((id) => !placeIds.includes(id));
		if (remaining.length === current.placeIds.length) return false;
		await cht.updateUser(current.username, { place: remaining });
		return true;
	});
}
