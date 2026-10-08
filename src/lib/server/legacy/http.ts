import { json, type RequestHandler } from '@sveltejs/kit';

import { deployment, type ContactType } from '../config';
import { ApiError, ChtError } from '../errors';

// The previous version's HTTP conventions, kept for its /api/v1 endpoints: a failure the endpoint
// expected is a 200 with a body saying so (each endpoint's own shape), and anything else is Fastify's
// default error: { statusCode, error, message }, a 500 unless it's the request that's malformed.

const STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request',
  415: 'Unsupported Media Type',
  500: 'Internal Server Error'
};

export class LegacyHttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly code?: string
  ) {
    super(message);
  }
}

export function fastifyError(statusCode: number, message: string, code?: string): Response {
  return json({ statusCode, ...(code ? { code } : {}), error: STATUS_TEXT[statusCode] ?? 'Error', message }, { status: statusCode });
}

export function legacyHandler(handler: RequestHandler): RequestHandler {
  return async (event) => {
    try {
      return await handler(event);
    } catch (e) {
      if (e instanceof LegacyHttpError) {
        return fastifyError(e.statusCode, e.message, e.code);
      }
      if (!(e instanceof ApiError) && !(e instanceof ChtError)) {
        console.error(e);
      }
      return fastifyError(500, errorMessage(e));
    }
  };
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// What the endpoints said when a step threw: `e.toString()`, as the previous version did
export function errorString(e: unknown): string {
  return e instanceof Error ? `Error: ${e.message}` : String(e);
}

// The body as Fastify parsed it: JSON, or a form (repeated fields become a list). Endpoints then
// require an object, as the previous version did
export async function readLegacyBody(request: Request): Promise<unknown> {
  const contentType = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const text = await request.text();
  if (!contentType) {
    if (text) {
      throw new LegacyHttpError(415, 'Unsupported Media Type', 'FST_ERR_CTP_INVALID_MEDIA_TYPE');
    }
    return undefined;
  }
  if (contentType === 'application/json' || contentType.endsWith('+json')) {
    if (!text) {
      throw new LegacyHttpError(400, "Body cannot be empty when content-type is set to 'application/json'", 'FST_ERR_CTP_EMPTY_JSON_BODY');
    }
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new LegacyHttpError(400, errorMessage(e), 'FST_ERR_CTP_INVALID_JSON_BODY');
    }
  }
  if (contentType === 'application/x-www-form-urlencoded') {
    const form: Record<string, string | string[]> = {};
    for (const [key, value] of new URLSearchParams(text)) {
      const existing = form[key];
      form[key] = existing === undefined ? value : [...(Array.isArray(existing) ? existing : [existing]), value];
    }
    return form;
  }
  throw new LegacyHttpError(415, `Unsupported Media Type: ${contentType}`, 'FST_ERR_CTP_INVALID_MEDIA_TYPE');
}

export function ensureJsonObjectBody(body: unknown): asserts body is Record<string, unknown> {
  const isPlainObject = typeof body === 'object' && body !== null && !Array.isArray(body);
  if (!isPlainObject) {
    throw new Error('body expected as application/json');
  }
}

export function isQueryFlagSet(url: URL, name: string): boolean {
  const raw = url.searchParams.get(name);
  return raw === '1' || raw === 'true';
}

export function legacyContactType(name: unknown): ContactType {
  const contactType = deployment().config.contact_types.find((type) => type.name === name);
  if (!contactType) {
    throw new Error(`unrecognized contact type: "${name}"`);
  }
  return contactType;
}
