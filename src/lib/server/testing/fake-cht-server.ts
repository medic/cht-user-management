import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Instance } from '../auth/instances';

// A real HTTP CHT (and identity provider) for exercising the login code over actual fetch: cookies,
// manual redirects and connection failures behave as they do against a real instance
export type FakeChtState = {
	username: string;
	password: string;
	userSettings?: Record<string, unknown>;
	version: string;
	permissions: Record<string, string[]>;
	setSessionCookie: boolean;
	// SSO
	accessToken: string;
	ssoUsername: string;
	// CHT 5.1.2 sends the redirect URL as the body of a 302, not in Location
	redirectInBody: boolean;
	setUserCtx: boolean;
	// every Authorization header CHT itself received
	authorizationSeenByCht: string[];
	// answer POST /_session this way instead, eg. as nginx does when the scheme is wrong
	sessionOverride?: { status: number; body?: string; location?: string };
};

export type FakeCht = {
	state: FakeChtState;
	instance: Instance;
	close(): Promise<void>;
};

const SESSION = 'abc123';

export async function startFakeCht(overrides: Partial<FakeChtState> = {}): Promise<FakeCht> {
	const state: FakeChtState = {
		username: 'alice',
		password: 'secret',
		userSettings: { roles: ['chu_manager'], facility_id: 'sub-1' },
		version: '4.18.0',
		permissions: {},
		setSessionCookie: true,
		accessToken: 'idp-token',
		ssoUsername: 'alice',
		redirectInBody: false,
		setUserCtx: true,
		authorizationSeenByCht: [],
		...overrides
	};

	const idp = await listen((req, res) => {
		const url = new URL(req.url ?? '/', 'http://idp');
		if (url.pathname === '/authorize') {
			if (req.headers.authorization !== `Bearer ${state.accessToken}`) {
				return send(res, 401, 'bad token');
			}
			res.setHeader('Set-Cookie', 'idp_session=xyz; Path=/');
			return redirect(res, `${chtUrl}/medic/login/oidc/callback?code=granted`, false);
		}
		send(res, 404, 'not found');
	});

	const cht = await listen(async (req, res) => {
		const url = new URL(req.url ?? '/', 'http://cht');
		if (req.headers.authorization && !url.pathname.startsWith('/_session')) {
			state.authorizationSeenByCht.push(req.headers.authorization);
		}
		const signedIn = (req.headers.cookie ?? '').includes(`AuthSession=${SESSION}`);

		if (req.method === 'POST' && url.pathname === '/_session' && state.sessionOverride) {
			const { status, body = '', location } = state.sessionOverride;
			if (location) {
				res.setHeader('Location', location);
			}
			return send(res, status, body);
		}
		if (req.method === 'POST' && url.pathname === '/_session') {
			const body = JSON.parse((await readBody(req)) || '{}');
			if (body.name !== state.username || body.password !== state.password) {
				return send(res, 401, JSON.stringify({ error: 'unauthorized' }));
			}
			if (state.setSessionCookie) {
				res.setHeader('Set-Cookie', `AuthSession=${SESSION}; Version=1; Path=/; HttpOnly`);
			}
			return send(res, 200, JSON.stringify({ ok: true }));
		}

		if (url.pathname === '/medic/login/oidc/authorize') {
			return redirect(res, `${idpUrl}/authorize?client=cht`, state.redirectInBody);
		}
		if (url.pathname === '/medic/login/oidc/callback') {
			const cookies = [`AuthSession=${SESSION}; Path=/; HttpOnly`];
			if (state.setUserCtx) {
				cookies.push(`userCtx=${encodeURIComponent(JSON.stringify({ name: state.ssoUsername, roles: [] }))}; Path=/`);
			}
			res.setHeader('Set-Cookie', cookies);
			return send(res, 200, 'signed in');
		}

		if (!signedIn) {
			return send(res, 401, JSON.stringify({ error: 'unauthorized' }));
		}
		if (url.pathname === `/medic/org.couchdb.user:${encodeURIComponent(state.username)}` || url.pathname === `/medic/org.couchdb.user:${state.ssoUsername}`) {
			return state.userSettings ? send(res, 200, JSON.stringify(state.userSettings)) : send(res, 404, '{}');
		}
		if (url.pathname === '/api/v2/monitoring') {
			return send(res, 200, JSON.stringify({ version: { app: state.version } }));
		}
		if (url.pathname === '/api/v1/settings') {
			return send(res, 200, JSON.stringify({ permissions: state.permissions }));
		}
		send(res, 404, '{}');
	});

	const chtUrl = `http://127.0.0.1:${port(cht)}`;
	const idpUrl = `http://127.0.0.1:${port(idp)}`;

	return {
		state,
		instance: { id: 'test', name: 'Test CHT', host: `127.0.0.1:${port(cht)}`, useHttp: true, idpOrigins: [idpUrl] },
		close: async () => {
			await Promise.all([close(cht), close(idp)]);
		}
	};
}

// Every permission the tool needs, granted to `role`
export function allPermissions(role: string, permissions: string[]): Record<string, string[]> {
	return Object.fromEntries(permissions.map((permission) => [permission, [role]]));
}

// A server that accepts connections and never answers, for timeouts
export async function startSilentServer(): Promise<{ host: string; close(): Promise<void> }> {
	const server = await listen(() => undefined);
	return { host: `127.0.0.1:${port(server)}`, close: () => close(server) };
}

function listen(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<Server> {
	const server = createServer(handler);
	return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function close(server: Server): Promise<void> {
	server.closeAllConnections();
	return new Promise((resolve) => server.close(() => resolve()));
}

function port(server: Server): number {
	return (server.address() as AddressInfo).port;
}

function send(res: ServerResponse, status: number, body: string) {
	res.statusCode = status;
	res.end(body);
}

function redirect(res: ServerResponse, location: string, inBody: boolean) {
	res.statusCode = 302;
	if (!inBody) {
		res.setHeader('Location', location);
	}
	res.end(inBody ? location : '');
}

function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve) => {
		let body = '';
		req.on('data', (chunk) => (body += chunk));
		req.on('end', () => resolve(body));
	});
}
