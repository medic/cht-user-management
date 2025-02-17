export class AuthError extends Error {
  constructor(
      public errorMessage: string
  ) {
    super(errorMessage);
    this.name = 'AuthError';
  }

  static INVALID_CREDENTIALS() {
    return new AuthError('Invalid username or password');
  }

  static MISSING_CREDENTIALS() {
    return new AuthError('Missing username or password');
  }

  static TOKEN_CREATION_FAILED(username: string, domain: string) {
    return new AuthError(`Failed to obtain token for ${username} at ${domain}`);
  }

  static MISSING_FACILITY(username: string) {
    return new AuthError(`User ${username} does not have a facility_id connected to their user doc`);
  }

  static INCOMPATIBLE_CHT_CORE_VERSION(domain: string, chtCoreVersion: string) {
    return new AuthError(`CHT Core Version must be 4.7.0 or higher. "${domain}" is running ${chtCoreVersion}.`);
  }

  static CANNOT_PARSE_CHT_VERSION(chtCoreVersion: string, domain: string) {
    return new AuthError(`Cannot parse cht core version ${chtCoreVersion} for instance "${domain}"`);
  }
}
