// Derives a CHT-safe username from a free-form source string (a person's name, or an
// oidc_username). Keeps only [a-z0-9_]: spaces become underscores, other characters are
// dropped, runs of underscores are collapsed, and the result is lowercased.
export function sanitizeUsername(source: string | undefined): string {
  const username = source
    ?.replace(/[ ]/g, '_')
    ?.replace(/[^a-zA-Z0-9_]/g, '')
    ?.replace(/_+/g, '_')
    ?.toLowerCase();

  if (!username) {
    throw Error('username cannot be empty');
  }

  return username;
}
