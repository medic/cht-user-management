import semver from 'semver';

import { ChtError } from '../errors';
import { authError } from './errors';
import { baseUrl, type Instance } from './instances';
import type { Session } from './session';

export type LoginOptions = {
	fetch: typeof fetch;
	allowAdminLogin: boolean;
	timeoutMs?: number;
};

// One minimum, used for both the check and the message (APP.md → Admitting the user)
export const MIN_CHT_VERSION = '4.9.0';

export const REQUIRED_PERMISSIONS = [
	'can_create_people',
	'can_create_places',
	'can_create_users',
	'can_delete_contacts',
	'can_delete_users',
	'can_edit',
	'can_update_users',
	'can_view_contacts',
	'can_view_users'
];

const ADMIN_ROLES = ['admin', '_admin'];
const SESSION_COOKIE_NAME = 'AuthSession';
const MAX_SSO_HOPS = 12;
const DEFAULT_TIMEOUT_MS = 15_000;

export async function loginWithPassword(instance: Instance, username: string, password: string, options: LoginOptions): Promise<Session> {
	if (!username || !password) {
		throw authError('MISSING_CREDENTIALS', 'Missing username or password');
	}

	const response = await send(options, instance, new URL('_session', baseUrl(instance)), {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Accept: 'application/json',
			Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
		},
		body: JSON.stringify({ name: username, password })
	});

	if (response.status === 401) {
		throw authError('INVALID_CREDENTIALS', 'Invalid username or password');
	}
	if (!response.ok) {
		throw await sessionRefused(instance, username, response);
	}
	const sessionValue = readCookies(response).get(SESSION_COOKIE_NAME);
	if (!sessionValue) {
		throw authError('NO_SESSION_COOKIE', `Failed to obtain a session for ${username} at ${instance.name}`, { status: response.status });
	}

	return admit(instance, username, `${SESSION_COOKIE_NAME}=${sessionValue}`, options);
}

// Follows CHT's own OIDC login flow server-side (APP.md → Creating a session with SSO). The access
// token is only ever sent to the instance's allowlisted identity-provider origins.
export async function loginWithSso(instance: Instance, accessToken: string, options: LoginOptions): Promise<Session> {
	if (!accessToken) {
		throw authError('MISSING_CREDENTIALS', 'Missing access token');
	}
	if (!instance.idpOrigins.length) {
		throw authError('SSO_DISABLED', `SSO is not enabled for ${instance.name}`);
	}

	const chtHost = new URL(baseUrl(instance)).host;
	const trustedOrigins = new Set(instance.idpOrigins.map((origin) => new URL(origin).origin));
	// one jar per host, each only ever sent back to its own host
	const jars = new Map<string, Map<string, string>>();
	let url = new URL('medic/login/oidc/authorize', baseUrl(instance));

	for (let hop = 0; hop < MAX_SSO_HOPS; hop++) {
		if (url.protocol !== 'https:' && url.protocol !== 'http:') {
			throw ssoFailed(hop, url, `unsupported redirect to ${url.protocol}`);
		}

		const jar = jars.get(url.host) ?? new Map<string, string>();
		jars.set(url.host, jar);
		const headers: Record<string, string> = { Accept: '*/*', 'User-Agent': 'cht-iam/sso-login' };
		if (trustedOrigins.has(url.origin)) {
			headers.Authorization = `Bearer ${accessToken}`;
		}
		if (jar.size) {
			headers.Cookie = [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
		}

		const response = await send(options, instance, url, { method: 'GET', headers });
		for (const [name, value] of readCookies(response)) {
			if (value) {
				jar.set(name, value);
			} else {
				jar.delete(name);
			}
		}

		if (response.status >= 300 && response.status < 400) {
			// some CHT versions send the redirect URL as the body instead of a Location header
			const body = (await response.text()).trim();
			const location = response.headers.get('location') ?? (/^https?:\/\//.test(body) ? body : undefined);
			if (location) {
				url = new URL(location, url);
				continue;
			}
		}

		if (!response.ok) {
			throw ssoFailed(hop, url, `HTTP ${response.status}`);
		}

		const chtJar = jars.get(chtHost);
		const sessionValue = chtJar?.get(SESSION_COOKIE_NAME);
		const username = usernameFromUserCtx(chtJar?.get('userCtx'));
		if (!sessionValue || !username) {
			throw ssoFailed(hop, url, `CHT did not set ${sessionValue ? 'a usable userCtx' : SESSION_COOKIE_NAME} cookie`);
		}
		return admit(instance, username, `${SESSION_COOKIE_NAME}=${sessionValue}`, options);
	}

	throw authError('SSO_FAILED', `SSO login did not finish within ${MAX_SSO_HOPS} redirects`, { step: MAX_SSO_HOPS });
}

// APP.md → Admitting the user: read the user, the version and the permissions, then check in order
async function admit(instance: Instance, username: string, sessionCookie: string, options: LoginOptions): Promise<Session> {
	const read = (path: string) => readJson(options, instance, path, sessionCookie);
	const [userSettings, monitoring, settings] = await Promise.all([
		read(`medic/org.couchdb.user:${encodeURIComponent(username)}`),
		read('api/v2/monitoring'),
		read('api/v1/settings')
	]);

	const roles: string[] = Array.isArray(userSettings?.roles) ? userSettings.roles : [];
	const isAdmin = roles.some((role) => ADMIN_ROLES.includes(role));

	if (isAdmin && !options.allowAdminLogin) {
		throw authError('ADMIN_LOGIN_DISABLED', `User ${username} is not allowed to login`);
	}

	if (!isAdmin) {
		const permissions: Record<string, string[]> = settings?.permissions ?? {};
		const missing = REQUIRED_PERMISSIONS.filter((permission) => !(permissions[permission] ?? []).some((role) => roles.includes(role)));
		if (missing.length) {
			console.warn(`User ${username} at ${instance.id} is missing permissions: ${missing.join(', ')}`);
			throw authError('MISSING_PERMISSIONS', `User ${username} does not have the required permissions`);
		}
	}

	const facilityIds = isAdmin
		? ['*']
		: [userSettings?.facility_id].flat().filter((id): id is string => typeof id === 'string' && id.length > 0);
	if (!facilityIds.length) {
		throw authError('NO_FACILITY', `User ${username} does not have a facility_id connected to their user doc`);
	}

	const reported = monitoring?.version?.app;
	const version = semver.coerce(typeof reported === 'string' ? reported : '')?.version;
	if (!version) {
		throw authError('UNSUPPORTED_CHT_VERSION', `Cannot parse CHT version ${reported}`, { actual: reported ?? null, minimum: MIN_CHT_VERSION });
	}
	if (semver.lt(version, MIN_CHT_VERSION)) {
		throw authError('UNSUPPORTED_CHT_VERSION', `CHT must be ${MIN_CHT_VERSION} or higher, ${instance.name} runs ${reported}`, {
			actual: reported,
			minimum: MIN_CHT_VERSION
		});
	}

	return { instanceId: instance.id, username, sessionCookie, facilityIds, chtVersion: version, isAdmin };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- CHT's untyped JSON; the callers pick out what they check
async function readJson(options: LoginOptions, instance: Instance, path: string, sessionCookie: string): Promise<any> {
	const response = await send(options, instance, new URL(path, baseUrl(instance)), {
		method: 'GET',
		headers: { Accept: 'application/json', Cookie: sessionCookie }
	});
	if (response.status === 404) {
		return undefined;
	}
	if (!response.ok) {
		throw new ChtError(response.status, `${path} returned ${response.status} while signing in`);
	}
	return response.json();
}

// Never follows redirects itself, and turns network failures into INSTANCE_UNREACHABLE
async function send(options: LoginOptions, instance: Instance, url: URL, init: RequestInit): Promise<Response> {
	try {
		return await options.fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS) });
	} catch (e) {
		const reason = networkFailure(e);
		const message =
			reason === 'not_found'
				? 'Unable to connect to instance. Please check instance availability.'
				: `Connection to ${instance.name} timed out. Please check your network and instance availability.`;
		throw authError('INSTANCE_UNREACHABLE', message, { reason, host: url.host });
	}
}

function networkFailure(error: unknown): 'not_found' | 'timeout' | 'refused' | 'network' {
	const code = (error as { cause?: { code?: string } })?.cause?.code;
	if ((error as Error)?.name === 'TimeoutError' || code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') {
		return 'timeout';
	}
	if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
		return 'not_found';
	}
	if (code === 'ECONNREFUSED') {
		return 'refused';
	}
	return 'network';
}

function readCookies(response: Response): Map<string, string> {
	const cookies = new Map<string, string>();
	for (const header of response.headers.getSetCookie()) {
		const [pair] = header.split(';');
		const separator = pair.indexOf('=');
		if (separator > 0) {
			cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
		}
	}
	return cookies;
}

// CHT's userCtx cookie is URL-encoded JSON: { "name": "<username>", ... }
function usernameFromUserCtx(value: string | undefined): string | undefined {
	if (!value) {
		return undefined;
	}
	try {
		const name = JSON.parse(decodeURIComponent(value))?.name;
		return typeof name === 'string' && name ? name : undefined;
	} catch {
		return undefined;
	}
}

// The usual cause is the instance's http/https setting not matching the port: nginx answers plain
// http on its https port with a 400, and redirects http to https with a 3xx
async function sessionRefused(instance: Instance, username: string, response: Response) {
	const scheme = instance.useHttp ? 'http' : 'https';
	const location = response.headers.get('location');
	if (response.status >= 300 && response.status < 400) {
		return authError(
			'NO_SESSION_COOKIE',
			`${instance.name} redirected the login${location ? ` to ${location}` : ''}. Check whether it should be reached over ${scheme === 'http' ? 'https' : 'http'}.`,
			{ status: response.status, location, scheme }
		);
	}

	const body = (await response.text().catch(() => '')).slice(0, 2000);
	if (response.status === 400 && /plain HTTP request was sent to HTTPS port/i.test(body)) {
		return authError('NO_SESSION_COOKIE', `${instance.name} expects https, but was reached over http. Check the instance's http setting.`, {
			status: response.status,
			scheme
		});
	}

	return authError('NO_SESSION_COOKIE', `Failed to obtain a session for ${username} at ${instance.name} (HTTP ${response.status})`, {
		status: response.status,
		scheme
	});
}

function ssoFailed(hop: number, url: URL, reason: string) {
	return authError('SSO_FAILED', `SSO login failed at ${url.host}: ${reason}`, { step: hop, host: url.host });
}
