export class AuthError extends Error {
  constructor(
      public status: number,
      public errorMessage: string
  ) {
    super(errorMessage);
    this.name = 'AuthError';
  }
}

export const AuthErrors = {
  INVALID_CREDENTIALS: () => new AuthError(401, 'Invalid username or password'),
  MISSING_CREDENTIALS: () => new AuthError(401, 'Missing username or password'),
};
