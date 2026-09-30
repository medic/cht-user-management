import { ApiError } from '../errors';

// Status for each auth error code, as listed in docs/api-contract.md §2
const STATUS = {
	MISSING_CREDENTIALS: 400,
	UNKNOWN_INSTANCE: 404,
	INVALID_CREDENTIALS: 401,
	NO_SESSION_COOKIE: 502,
	SSO_FAILED: 502,
	SSO_DISABLED: 403,
	INSTANCE_UNREACHABLE: 504,
	ADMIN_LOGIN_DISABLED: 403,
	MISSING_PERMISSIONS: 403,
	NO_FACILITY: 403,
	UNSUPPORTED_CHT_VERSION: 422,
	UNAUTHENTICATED: 401,
	SESSION_EXPIRED: 401
} as const;

export type AuthErrorCode = keyof typeof STATUS;

export function authError(code: AuthErrorCode, message: string, details?: Record<string, unknown>): ApiError {
	return new ApiError(STATUS[code], code, message, details);
}
