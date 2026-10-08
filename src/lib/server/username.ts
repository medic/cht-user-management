// Ported from src/services/username.ts: keeps only [a-z0-9_], spaces become underscores
export function sanitizeUsername(source: string | undefined): string {
  const username = source
    ?.replace(/[ ]/g, '_')
    ?.replace(/[^a-zA-Z0-9_]/g, '')
    ?.replace(/_+/g, '_')
    ?.toLowerCase();

  if (!username) {
    throw new Error('username cannot be empty');
  }
  return username;
}

// 9 characters: CHT requires 8 minimum plus special characters
export function generatePassword(): string {
  const LENGTH = 9;
  const ELIGIBLE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,';
  const bytes = crypto.getRandomValues(new Uint32Array(LENGTH));
  return Array.from(bytes, (byte) => ELIGIBLE[byte % ELIGIBLE.length]).join('');
}
