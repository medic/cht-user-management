import crypto from 'node:crypto';

// AES-256-GCM with a fresh IV per value, prefixed with the id of the key that encrypted it, so
// SECRET_KEY can be rotated (APP.md → Data storage → Encryption)
const KEY_ID = 'k1';

export function encrypt(text: string, secretKeyHex: string): string {
	const iv = crypto.randomBytes(12);
	const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(secretKeyHex, 'hex'), iv);
	const encrypted = cipher.update(text, 'utf8', 'hex') + cipher.final('hex');
	return `${KEY_ID}:${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${encrypted}`;
}

export function decrypt(value: string, secretKeyHex: string): string {
	const [keyId, ivHex, tagHex, encrypted] = value.split(':');
	if (keyId !== KEY_ID || !ivHex || !tagHex || encrypted === undefined) {
		throw new Error(`unreadable encrypted value (key "${keyId}")`);
	}
	const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(secretKeyHex, 'hex'), Buffer.from(ivHex, 'hex'));
	decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
	return decipher.update(encrypted, 'hex', 'utf8') + decipher.final('utf8');
}
