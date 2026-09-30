import { assertAuthorized } from '../auth/session';
import { getContactType, getParentLevel, mutate, type PlaceDraft } from '../config';
import { ApiError } from '../errors';
import { isUpdateConflict, type Cht, type CouchDoc, type NewUser } from '../cht/client';
import { buildProperties, resolveRoles, type ValidationErrors } from '../../validation';
import { generatePassword, sanitizeUsername } from '../username';
import type { OperationContext, OperationResult } from './context';
import type { CreateRequest } from './schemas';
import { recallPassword, recordCredentials } from './credentials';
import { rememberPlace } from './lookup';
import { fromWarningTexts, uniquePropertyWarnings, warningText, type Warning } from './unique';
import {
	TOOL,
	contactAttributes,
	contactRef,
	createUserWithRetries,
	docType,
	ensureUserHasPlaces,
	fetchDocs,
	lineageIds,
	lineageNames,
	minifiedLineage,
	retryOnConflict,
	userForContact,
	withoutReplacement
} from './documents';

export type CreateResult = {
	outcome: 'created' | 'already_applied';
	placeId: string;
	contactId: string;
	username: string;
	password: string | null;
	warnings: Warning[];
};

export type PreparedCreate = Awaited<ReturnType<typeof prepareCreate>>;

// Every check a create makes before writing: validation, the parent, ids already in use, and
// duplicate warnings. The staged list runs this when an item is added; createPlace runs it again
// before writing.
export async function prepareCreate(context: OperationContext, placeId: string, request: CreateRequest) {
	const { cht, session } = context;
	const contactType = getContactType(request.contactType, 'create');
	const contactId = request.contact.id;
	if (contactId === placeId) {
		throw validationFailed({ 'contact.id': 'must differ from the place id' });
	}

	const parentDoc = await cht.getDoc(request.parentId);
	if (!parentDoc) {
		throw new ApiError(404, 'PARENT_NOT_FOUND', `parent "${request.parentId}" was not found`);
	}
	const parentType = getParentLevel(contactType).contact_type;
	if (docType(parentDoc) !== parentType) {
		throw new ApiError(422, 'PARENT_WRONG_TYPE', `parent "${request.parentId}" is a "${docType(parentDoc)}", expected "${parentType}"`);
	}
	const parentLineage = lineageIds(parentDoc);
	assertAuthorized(session, [parentDoc._id, ...parentLineage]);

	const [existingPlace, existingContact] = await fetchDocs(cht, [placeId, contactId]);
	if (existingPlace) {
		const samePlace =
			docType(existingPlace) === contactType.name &&
			existingPlace.parent?._id === parentDoc._id &&
			contactRef(existingPlace.contact) === contactId;
		if (!samePlace) {
			throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', `"${placeId}" already exists with a different type, parent or contact`);
		}
	}
	if (existingContact) {
		if (docType(existingContact) !== contactType.contact_type) {
			throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', `"${contactId}" already exists and is not a "${contactType.contact_type}"`);
		}
		const sharesContact = existingContact.parent?._id !== placeId;
		if (sharesContact && !contactType.can_assign_multiple) {
			throw new ApiError(409, 'CONTACT_ALREADY_ASSIGNED', `contact "${contactId}" belongs to another place and "${contactType.name}" cannot share contacts`);
		}
	}

	const ancestors = [parentDoc, ...(await fetchDocs(cht, parentLineage))];
	const lineage = lineageNames(contactType, ancestors);
	const writeContact = !existingContact;
	const built = buildProperties({
		contactType,
		mode: 'create',
		place: request.place,
		contact: writeContact ? (request.contact.properties ?? {}) : undefined,
		lineage
	});
	const roles = resolveRoles(contactType, request.user?.roles);
	const errors: ValidationErrors = { ...built.errors };
	if (writeContact && !request.contact.properties) {
		errors['contact.properties'] = 'Is Required';
	}
	if (roles.error) {
		errors['user.roles'] = roles.error;
	}
	if (Object.keys(errors).length) {
		throw validationFailed(errors);
	}

	let warnings: Warning[] = fromWarningTexts(existingPlace?.user_attribution?.warnings);
	if (!existingPlace) {
		warnings = [
			...(context.extraWarnings ?? []),
			...(await uniquePropertyWarnings(cht, contactType, { placeId, parentId: parentDoc._id, values: built.place }))
		];
		if (warnings.length && !request.ignoreWarnings) {
			throw new ApiError(409, 'WARNINGS', 'the request has warnings; re-send with ignoreWarnings to proceed', { warnings });
		}
	}

	return { contactType, contactId, parentDoc, ancestors, existingPlace, existingContact, lineage, writeContact, built, roles, warnings };
}

// PUT /api/v1/places/{placeId} — every step checks what already exists, so repeating the same request
// resumes an interrupted attempt and replays a finished one
export async function createPlace(context: OperationContext, placeId: string, request: CreateRequest): Promise<OperationResult<CreateResult>> {
	const { cht, session } = context;
	const { contactType, contactId, parentDoc, existingPlace, existingContact, lineage, writeContact, built, roles, warnings } =
		await prepareCreate(context, placeId, request);

	const now = Date.now();
	const attribution = { tool: TOOL, username: session.username, created_time: now, warnings: warnings.map(warningText) };
	const placeLineage = minifiedLineage(parentDoc);
	let changed = false;

	let placeDoc = existingPlace;
	if (!placeDoc) {
		const draft: PlaceDraft = { ...built.place, contact_type: contactType.name, parent: parentDoc._id };
		await mutate(draft, { cht, contactType, isReplacement: false });
		const { contact_type: _contactType, parent: _parent, ...fields } = draft;
		const contactLineage = existingContact?.parent ? { parent: existingContact.parent } : { parent: { _id: placeId, parent: placeLineage } };
		placeDoc = {
			...fields,
			...contactAttributes(contactType.name),
			_id: placeId,
			parent: placeLineage,
			contact: { _id: contactId, ...contactLineage },
			reported_date: now,
			user_attribution: attribution
		};
		await putNew(cht, placeDoc, (doc) => docType(doc) === contactType.name && doc.parent?._id === parentDoc._id);
		rememberPlace(cht, contactType.name, placeDoc);
		changed = true;
	}

	if (writeContact) {
		const contactDoc: CouchDoc = {
			...built.contact,
			...contactAttributes(contactType.contact_type),
			_id: contactId,
			parent: { _id: placeId, parent: placeLineage },
			reported_date: now,
			user_attribution: attribution
		};
		await putNew(cht, contactDoc, (doc) => docType(doc) === contactType.contact_type && doc.parent?._id === placeId);
		changed = true;
	}

	const contactValues = existingContact ?? built.contact;
	let username: string;
	let password: string | null;
	let logCredentials = false;
	const existingUser = await userForContact(cht, contactId);
	if (!existingUser) {
		const usernameSource = contactType.username_from_place ? (built.place.name ?? placeDoc.name) : contactValues.name;
		const user: NewUser = {
			username: sanitizeUsername(usernameSource),
			password: generatePassword(),
			roles: roles.roles,
			place: [placeId],
			contact: contactId,
			fullname: contactValues.name,
			phone: contactValues.phone,
			password_change_required: contactValues.require_password_change === 'yes'
		};
		({ username, password } = await createUserWithRetries(cht, user, generatePassword));
		changed = true;
		logCredentials = true;
	} else {
		const addedPlace = await ensureUserHasPlaces(cht, existingUser, [placeId]);
		changed ||= addedPlace;
		username = existingUser.username;
		password = await recallPassword(context.uploadLog, session.username, contactId);
		logCredentials = addedPlace && !!password;
	}

	if (logCredentials && password) {
		await recordCredentials(context.uploadLog, session.username, {
			place: String(placeDoc.name ?? ''),
			person: String(contactValues.name ?? ''),
			phone: String(contactValues.phone ?? ''),
			contactType: contactType.name,
			credentials: { username, password, placeId, contactId, created_at: now },
			hierarchy: withoutReplacement(lineage)
		});
	}

	return {
		status: changed ? 201 : 200,
		body: { outcome: changed ? 'created' : 'already_applied', placeId, contactId, username, password, warnings }
	};
}

export function validationFailed(errors: ValidationErrors): ApiError {
	return new ApiError(422, 'VALIDATION_FAILED', 'one or more properties are invalid', errors);
}

// A document update conflict on creating a doc means one with that id is there: fine if it's the
// doc this request would write (an earlier attempt, or a concurrent one), retried if it has gone
// again by the time it's read, and a real conflict only if it's something else
export async function putNew(cht: Cht, doc: CouchDoc, isEquivalent: (existing: CouchDoc) => boolean): Promise<void> {
	await retryOnConflict(async () => {
		try {
			await cht.putDoc(doc);
		} catch (e) {
			if (!isUpdateConflict(e)) {
				throw e;
			}
			const existing = await cht.getDoc(doc._id);
			if (!existing) {
				throw e;
			}
			if (!isEquivalent(existing)) {
				throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', `"${doc._id}" already exists as something else, written by another request`);
			}
		}
	});
}
