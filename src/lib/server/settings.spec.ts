import { describe, expect, it } from 'vitest';

import { loadSettings } from './settings';

const valid = {
	COOKIE_PRIVATE_KEY: 'c'.repeat(40),
	WORKER_PRIVATE_KEY: 'w'.repeat(40),
	SECRET_KEY: 'a'.repeat(64),
	REDIS_URL: 'redis://localhost:6379',
	DEPLOYMENT_DIR: 'deployments/ke'
};
const instancesFile = JSON.stringify({ instances: [{ id: 'ke-prod', name: 'Kenya eCHIS', host: 'echis.example.org' }] });
const noInstances = JSON.stringify({ instances: [] });
const reads = (text: string | undefined) => () => {
	if (text === undefined) {
		throw new Error('ENOENT');
	}
	return text;
};
// only the named files exist
const files = (byPath: Record<string, string>) => (path: string) => {
	if (!(path in byPath)) {
		throw new Error('ENOENT');
	}
	return byPath[path];
};

describe('loadSettings', () => {
	it('reads the instance list and applies defaults', () => {
		const settings = loadSettings(valid, reads(instancesFile));

		expect(settings.instances).toEqual([{ id: 'ke-prod', name: 'Kenya eCHIS', host: 'echis.example.org', useHttp: false, idpOrigins: [] }]);
		expect(settings).toMatchObject({ deploymentDir: 'deployments/ke', sessionTtlSeconds: 86400, credentialsTtlSeconds: 432000, allowAdminLogin: true, production: false });
	});

	it('reads the instances in the deployment folder', () => {
		const tg = JSON.stringify({ instances: [{ id: 'tg', name: 'Togo', host: 'tg.example.org' }] });
		const disk = files({ 'deployments/ke/instances.json': instancesFile, 'deployments/tg/instances.json': tg });

		expect(loadSettings(valid, disk)).toMatchObject({ deploymentDir: 'deployments/ke', instances: [{ id: 'ke-prod' }] });
		expect(loadSettings({ ...valid, DEPLOYMENT_DIR: 'deployments/tg' }, disk).instances.map((i) => i.id)).toEqual(['tg']);
	});

	it('refuses to start without a deployment folder, or one without instances.json', () => {
		const { DEPLOYMENT_DIR: _, ...none } = valid;
		expect(() => loadSettings(none, files({}))).toThrow(/DEPLOYMENT_DIR is required/);
		expect(() => loadSettings({ ...valid, DEPLOYMENT_DIR: 'nowhere' }, files({}))).toThrow(/nowhere\/instances\.json could not be read: DEPLOYMENT_DIR must be a deployment's folder/);
	});

	it('refuses to start with an invalid PORT', () => {
		expect(() => loadSettings({ ...valid, PORT: 'abc' }, reads(instancesFile))).toThrow(/PORT must be a number/);
		expect(() => loadSettings({ ...valid, PORT: '70000' }, reads(instancesFile))).toThrow(/PORT must be a number/);
		expect(() => loadSettings({ ...valid, PORT: '3000' }, reads(instancesFile))).not.toThrow();
	});

	it('refuses to start without any instance, and rejects hosts with a scheme', () => {
		expect(() => loadSettings(valid, reads(noInstances))).toThrow(/no CHT instances configured/);
		const withScheme = JSON.stringify({ instances: [{ id: 'x', name: 'X', host: 'https://x.org' }] });
		expect(() => loadSettings(valid, reads(withScheme))).toThrow(/host/);
	});

	it('adds a development instance, over https unless told otherwise, but never in production', () => {
		const dev = { ...valid, CHT_DEV_INSTANCE: 'localhost:5988' };
		expect(loadSettings(dev, reads(noInstances)).instances).toEqual([
			{ id: 'dev', name: 'Development', host: 'localhost:5988', useHttp: false, idpOrigins: [] }
		]);
		expect(loadSettings({ ...dev, CHT_DEV_HTTP: 'true' }, reads(noInstances)).instances[0].useHttp).toBe(true);
		expect(() => loadSettings({ ...dev, NODE_ENV: 'production' }, reads(noInstances))).toThrow(/no CHT instances configured/);
	});
});
