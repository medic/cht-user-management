import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';

const DEFAULT_PORT = 3000;

// PORT from the environment, else from .env — the same setting `node build` uses in production
function portFrom(env: Record<string, string>): number {
	const raw = process.env.PORT ?? env.PORT;
	if (!raw) {
		return DEFAULT_PORT;
	}
	const port = Number(raw);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error(`PORT must be a number between 1 and 65535, not "${raw}"`);
	}
	return port;
}

export default defineConfig(({ mode }) => {
	const port = portFrom(loadEnv(mode, process.cwd(), ''));

	return {
		plugins: [
			sveltekit({
				compilerOptions: {
					// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
					runes: ({ filename }) => filename.split(/[/\\]/).includes('node_modules') ? undefined : true
				},
				adapter: adapter()
			})
		],
		server: {
			port,
			// fail rather than silently moving to another port, so the app is where .env says
			strictPort: true
		},
		preview: {
			port,
			strictPort: true
		},
		test: {
			expect: { requireAssertions: true },
			projects: [
				{
					extends: './vite.config.ts',
					test: {
						name: 'server',
						environment: 'node',
						include: ['src/**/*.{test,spec}.{js,ts}'],
						exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
					}
				}
			]
		}
	};
});
