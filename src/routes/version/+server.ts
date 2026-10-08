import { version } from '../../../package.json';

// GET /version: the running version as plain text, as the previous version served it. Public
export const GET = () => new Response(version, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
