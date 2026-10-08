import { findCredentials, type CredentialsOwner, type UploadLog, type UploadLogRecord } from '../upload-log';

// Logging happens after CHT accepted the user; failing the request here would hide the password
// from the one response that carries it
export async function recordCredentials(uploadLog: UploadLog, owner: CredentialsOwner, record: Omit<UploadLogRecord, 'id'>): Promise<void> {
  try {
    await uploadLog.log(owner, record);
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
  // when the record forgets it: ttlSeconds after it was made
  expiresAt?: string;
};

// GET /api/v2/credentials: the caller's record, newest first, optionally only for some places
export async function credentialsFor(
  uploadLog: UploadLog,
  owner: CredentialsOwner,
  placeIds?: string[],
  ttlSeconds?: number
): Promise<CredentialsEntry[]> {
  const records = await uploadLog.list(owner);
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
      createdAt: record.credentials.created_at ? new Date(record.credentials.created_at).toISOString() : undefined,
      expiresAt:
        record.credentials.created_at && ttlSeconds ? new Date(record.credentials.created_at + ttlSeconds * 1000).toISOString() : undefined
    }));
}

export async function recallPassword(uploadLog: UploadLog, owner: CredentialsOwner, contactId: string): Promise<string | null> {
  try {
    return (await findCredentials(uploadLog, owner, contactId))?.password ?? null;
  } catch (e) {
    console.error(`could not read upload log for contact ${contactId}`, e);
    return null;
  }
}
