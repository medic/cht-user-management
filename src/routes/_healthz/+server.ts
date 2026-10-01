import { json } from '@sveltejs/kit';

// GET /_healthz: the server is up, for container and Kubernetes probes. Public, like the sign-in page.
// A server whose settings or deployment folder are broken never gets this far: it refuses to start
export const GET = () => json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
