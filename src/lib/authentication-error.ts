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

  static INSTANCE_OFFLINE() {
    return new AuthError(`Unable to connect to instance. Please check instance availability.`);
  }

  static MISSING_PERMISSIONS(username: string) {
    return new AuthError(`User ${username} does not have the required permissions`);
  }

  public static CONNECTION_TIMEOUT(domain: string): AuthError {
    return new AuthError(`Connection to ${domain} timed out. Please check your network and instance availability.`);
  }

  static LOGIN_DISALLOWED(username: string) {
    return new AuthError(`User ${username} is not allowed to login`);
  }
}
