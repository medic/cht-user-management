import { findCredentials, type UploadLog, type UploadLogRecord } from '../upload-log';

// Logging happens after CHT accepted the user; failing the request here would hide the password
// from the one response that carries it
export async function recordCredentials(uploadLog: UploadLog, creator: string, record: Omit<UploadLogRecord, 'id'>): Promise<void> {
	try {
		await uploadLog.log(creator, record);
	} catch (e) {
		console.error(`could not write upload log for contact ${record.credentials.contactId}`, e);
	}
}

export type CredentialsEntry = {
	placeId?: string;
	contactId?: string;
	place: string;
	person: string;
	phone: string;
	username?: string;
	password?: string;
	createdAt?: string;
};

// GET /api/v1/credentials: the caller's record, newest first, optionally only for some places
export async function credentialsFor(uploadLog: UploadLog, creator: string, placeIds?: string[]): Promise<CredentialsEntry[]> {
	const records = await uploadLog.list(creator);
	return records
		.filter((record) => !placeIds?.length || (record.credentials.placeId && placeIds.includes(record.credentials.placeId)))
		.map((record) => ({
			placeId: record.credentials.placeId,
			contactId: record.credentials.contactId,
			place: record.place,
			person: record.person,
			phone: record.phone,
			username: record.credentials.username,
			password: record.credentials.password,
			createdAt: record.credentials.created_at ? new Date(record.credentials.created_at).toISOString() : undefined
		}));
}

export async function recallPassword(uploadLog: UploadLog, creator: string, contactId: string): Promise<string | null> {
	try {
		return (await findCredentials(uploadLog, creator, contactId))?.password ?? null;
	} catch (e) {
		console.error(`could not read upload log for contact ${contactId}`, e);
		return null;
	}
}
