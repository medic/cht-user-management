import { json, type Cookies, type RequestHandler } from '@sveltejs/kit';
import type { z } from 'zod';

import { authError } from './auth/errors';
import { SESSION_COOKIE, type Authenticated } from './auth/session';
import { HttpCht } from './cht/client';
import { ApiError, ChtError } from './errors';
import type { OperationContext } from './places/context';
import type { JobDeps } from './hierarchy/service';
import { getJobStore, getStagedStore, getUploadLog, getUploadTracker, getValidationTracker } from './runtime';
import { getSettings } from './settings';
import type { StagedDeps } from './staged/service';

export type ErrorBody = { error: { code: string; message: string; details?: Record<string, unknown> } };

export function toErrorBody(error: unknown): { status: number; body: ErrorBody } {
  // CHT rejecting the stored CouchDB session means the user has to sign in again (APP.md → Session
  // lifetime). CouchDB answers an expired session with 401, but a malformed one with 400.
  if (error instanceof ChtError && isRejectedSession(error)) {
    error = authError('SESSION_EXPIRED', 'Your CHT session has ended. Please sign in again.');
  }
  if (error instanceof ApiError) {
    return { status: error.status, body: { error: { code: error.code, message: error.message, details: error.details } } };
  }
  if (error instanceof ChtError) {
    return {
      status: 502,
      body: {
        error: {
          code: 'UPSTREAM_FAILED',
          message: `CHT request failed: ${error.message}. Retrying the same request resumes it.`,
          details: { chtStatus: error.status ?? null }
        }
      }
    };
  }

  console.error(error);
  return { status: 500, body: { error: { code: 'INTERNAL', message: 'unexpected error' } } };
}

function isRejectedSession(error: ChtError): boolean {
  return error.status === 401 || (error.status === 400 && /AuthSession/i.test(error.message));
}

export function errorResponse(error: unknown, cookies?: Cookies): Response {
  const { status, body } = toErrorBody(error);
  if (cookies && body.error.code === 'SESSION_EXPIRED') {
    clearSessionCookie(cookies);
  }
  return json(body, { status });
}

// Wraps a handler so every failure leaves as the documented error envelope
export function apiHandler(handler: RequestHandler): RequestHandler {
  return async (event) => {
    try {
      return await handler(event);
    } catch (e) {
      return errorResponse(e, event.cookies);
    }
  };
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'request body must be JSON');
  }
}

export function parseWith<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ApiError(400, 'INVALID_REQUEST', 'request does not match the expected shape', {
      issues: result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
    });
  }
  return result.data;
}

export function requireAuth(locals: App.Locals): Authenticated {
  if (!locals.auth) {
    throw authError('UNAUTHENTICATED', 'sign in first');
  }
  return locals.auth;
}

export function operationContext(locals: App.Locals): OperationContext {
  const { session, instance } = requireAuth(locals);
  return {
    session,
    cht: new HttpCht({ domain: instance.host, useHttp: instance.useHttp, sessionCookie: session.sessionCookie }),
    uploadLog: getUploadLog()
  };
}

// What the hierarchy job API needs from a request
export function jobDeps(locals: App.Locals): JobDeps {
  const { cht, session } = operationContext(locals);
  const settings = getSettings();
  return { cht, session, store: getJobStore(), workerKey: settings.workerKey, settings: settings.jobs };
}

// SvelteKit sets `secure` by default, except on http://localhost during development
export function setSessionCookie(cookies: Cookies, token: string, maxAgeSeconds: number): void {
  cookies.set(SESSION_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', maxAge: maxAgeSeconds });
}

export function clearSessionCookie(cookies: Cookies): void {
  cookies.delete(SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'lax' });
}

export function stagedDeps(locals: App.Locals): StagedDeps {
  return {
    store: getStagedStore(),
    tracker: getUploadTracker(),
    validationTracker: getValidationTracker(),
    context: operationContext(locals),
    maxBatch: getSettings().batchMaxItems,
    jobs: { store: getJobStore(), workerKey: getSettings().workerKey, settings: getSettings().jobs },
    ttlSeconds: getSettings().dataTtlSeconds
  };
}

// Route parameters are typed as optional once a handler is wrapped; this checks one is present
export function requireParam(value: string | undefined): string {
  if (!value) {
    throw new ApiError(400, 'INVALID_REQUEST', 'missing path parameter');
  }
  return value;
}
