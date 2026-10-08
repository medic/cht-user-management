import type { Handle, ServerInit } from '@sveltejs/kit';

import { authenticate } from '$lib/server/auth/authenticate';
import { authError } from '$lib/server/auth/errors';
import { presentedToken, SESSION_COOKIE } from '$lib/server/auth/session';
import { errorResponse } from '$lib/server/http';
import { LEGACY_AUTH_COOKIE, LEGACY_PUBLIC_PATHS } from '$lib/server/legacy/auth';
import { getRevocations, startDataSweeper, startJobRunner } from '$lib/server/runtime';
import { checkDeployment } from '$lib/server/config';
import { startMetrics, timeRequest } from '$lib/server/metrics';
import { setMaxPlacesLoaded } from '$lib/server/places/lookup';
import { getSettings } from '$lib/server/settings';

// Refuse to start when a setting or the deployment's folder is missing or invalid (APP.md → Auth →
// Configuration)
export const init: ServerInit = async () => {
  setMaxPlacesLoaded(getSettings().maxPlacesLoaded);
  await checkDeployment();
  startMetrics();
  startJobRunner();
  startDataSweeper();
};

// the dev server reloads this module on changes without calling init again: redo what it set up
if (import.meta.env.DEV) {
  setMaxPlacesLoaded(getSettings().maxPlacesLoaded);
  startJobRunner();
  startDataSweeper();
}

const PUBLIC_PATHS = new Set(['/api/v2/config/instances', '/api/v2/config/logo', '/api/v2/auth/login', '/api/v2/auth/sso']);

// Every response gets the security headers; API responses also stay out of caches, since some carry
// passwords. Pages also get a Content-Security-Policy, from the csp option in vite.config.ts
const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()'
};

// Each request is timed for /metrics, by its route
export const handle: Handle = async ({ event, resolve }) => {
  const done = timeRequest(event.request.method);
  try {
    const response = await secured({ event, resolve });
    done?.(event.route.id, response.status);
    return response;
  } catch (e) {
    done?.(event.route.id, 500);
    throw e;
  }
};

const secured: Handle = async ({ event, resolve }) => {
  let response = await authenticated({ event, resolve });
  const headers: Record<string, string> = { ...SECURITY_HEADERS };
  // browsers only heed it over https, so it's harmless behind plain http
  if (import.meta.env.PROD) headers['Strict-Transport-Security'] = 'max-age=31536000';
  if (routedPath(event.url.pathname).startsWith('/api/') && !response.headers.has('Cache-Control')) {
    headers['Cache-Control'] = 'no-store';
  }
  try {
    for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
  } catch {
    // a response with fixed headers, eg. a redirect: copied so they can be added
    response = new Response(response.body, response);
    for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
  }
  return response;
};

// The path as SvelteKit routes it, decoded: "/%61pi/…" reaches the same handler as "/api/…". One that
// can't be decoded is treated as an API path, so it has to be signed in for
function routedPath(pathname: string): string {
  try {
    return decodeURI(pathname);
  } catch {
    return '/api/';
  }
}

const authenticated = async ({ event, resolve }: Parameters<Handle>[0]): Promise<Response> => {
  const pathname = routedPath(event.url.pathname);
  if (!pathname.startsWith('/api/') || PUBLIC_PATHS.has(pathname) || LEGACY_PUBLIC_PATHS.has(pathname)) {
    return resolve(event);
  }

  // the previous version's endpoints (/api/v1) also take the token from its cookie, and send anyone
  // not signed in to the login page, as it did
  const legacy = pathname.startsWith('/api/v1/');
  try {
    const cookie = (legacy ? event.cookies.get(LEGACY_AUTH_COOKIE) : undefined) ?? event.cookies.get(SESSION_COOKIE);
    const token = presentedToken(event.request.headers.get('authorization'), cookie);
    if (!token) {
      throw authError('UNAUTHENTICATED', 'sign in first');
    }
    const settings = getSettings();
    event.locals.auth = await authenticate(token, {
      cookieKey: settings.cookieKey,
      revocations: getRevocations(),
      instances: settings.instances
    });
  } catch (e) {
    return legacy ? new Response(null, { status: 302, headers: { Location: '/login' } }) : errorResponse(e);
  }

  return resolve(event);
};
