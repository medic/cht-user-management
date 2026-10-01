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
    expect(settings).toMatchObject({
      deploymentDir: 'deployments/ke',
      sessionTtlSeconds: 86400,
      dataTtlSeconds: 1209600,
      allowAdminLogin: true,
      production: false
    });
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
    expect(() => loadSettings({ ...valid, DEPLOYMENT_DIR: 'nowhere' }, files({}))).toThrow(
      `DEPLOYMENT_DIR "nowhere" doesn't exist: point it at the deployment's folder, or mount the folder there`
    );
    // the folder is there, but isn't a deployment's
    expect(() => loadSettings({ ...valid, DEPLOYMENT_DIR: 'docs' }, files({}))).toThrow(
      /docs\/instances\.json could not be read: DEPLOYMENT_DIR must be a deployment's folder/
    );
  });

  it('refuses to start without secrets, with equal keys, or with a malformed secret key', () => {
    expect(() => loadSettings({}, reads(instancesFile))).toThrow(/COOKIE_PRIVATE_KEY is required[\s\S]*REDIS_URL is required/);
    expect(() => loadSettings({ ...valid, WORKER_PRIVATE_KEY: valid.COOKIE_PRIVATE_KEY }, reads(instancesFile))).toThrow(/must differ/);
    expect(() => loadSettings({ ...valid, SECRET_KEY: 'nothex' }, reads(instancesFile))).toThrow(/SECRET_KEY must be 64 hex/);
  });

  it('holds data for DATA_RETENTION_TTL, the one lifetime, and refuses the settings it replaced', () => {
    const settings = loadSettings({ ...valid, DATA_RETENTION_TTL: '604800' }, reads(instancesFile));
    expect(settings.dataTtlSeconds).toBe(604800);
    // jobs, and the token a queued job carries, use it too
    expect(settings.jobs.ttlSeconds).toBe(604800);
    for (const name of ['STAGED_LIST_TTL', 'CREDENTIALS_TTL', 'JOB_TTL', 'ARCHIVE_TTL']) {
      expect(() => loadSettings({ ...valid, [name]: '100' }, reads(instancesFile)), name).toThrow(
        `${name} is no longer read: DATA_RETENTION_TTL is how long all stored data is kept`
      );
    }
  });

  it('reads MAX_PLACES_LOADED, a count, and refuses anything else', () => {
    expect(loadSettings(valid, reads(instancesFile)).maxPlacesLoaded).toBe(10_000);
    expect(loadSettings({ ...valid, MAX_PLACES_LOADED: '500' }, reads(instancesFile)).maxPlacesLoaded).toBe(500);
    expect(() => loadSettings({ ...valid, MAX_PLACES_LOADED: 'lots' }, reads(instancesFile))).toThrow(
      'MAX_PLACES_LOADED must be a positive number'
    );
    expect(() => loadSettings({ ...valid, BATCH_MAX_ITEMS: '0' }, reads(instancesFile))).toThrow(
      /BATCH_MAX_ITEMS must be a positive number$/m
    );
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
