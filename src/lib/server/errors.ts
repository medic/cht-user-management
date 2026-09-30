export class ApiError extends Error {
	constructor(
		public readonly status: number,
		public readonly code: string,
		message: string,
		public readonly details?: Record<string, unknown>
	) {
		super(message);
		this.name = 'ApiError';
	}
}

export class ChtError extends Error {
	constructor(
		public readonly status: number | undefined,
		message: string,
		public readonly body?: unknown
	) {
		super(message);
		this.name = 'ChtError';
	}
}

export function isChtStatus(error: unknown, status: number): boolean {
	return error instanceof ChtError && error.status === status;
}
