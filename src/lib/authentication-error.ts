export class AuthError extends Error {
  constructor(
      public status: number,
      public errorMessage: string
  ) {
    super(errorMessage);
    this.name = 'AuthError';
  }

  static INVALID_CREDENTIALS() {
    return new AuthError(403, 'Invalid username or password');
  }

  static MISSING_CREDENTIALS() {
    return new AuthError(401, 'Missing username or password');
  }

  static TOKEN_CREATION_FAILED(username: string, domain: string) {
    return new AuthError(401, `Failed to obtain token for ${username} at ${domain}`);
  }

  static MISSING_FACILITY(username: string) {
    return new AuthError(401, `User ${username} does not have a facility_id connected to their user doc`);
  }

  static INCOMPATIBLE_CHT_CORE_VERSION(domain: string, chtCoreVersion: string) {
    return new AuthError(401, `CHT Core Version must be 4.7.0 or higher. "${domain}" is running ${chtCoreVersion}.`);
  }

  static CANNOT_PARSE_CHT_VERSION(chtCoreVersion: string, domain: string) {
    return new AuthError(401, `Cannot parse cht core version ${chtCoreVersion} for instance "${domain}"`);
  }
}
