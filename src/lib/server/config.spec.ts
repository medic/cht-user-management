import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({ DEPLOYMENT_DIR: 'config/deployments/chis-ke' as string | undefined }));
vi.mock('$env/dynamic/private', () => ({ env }));

import { checkDeployment, deploymentLogo, getContactType, loadDeployment, mutate } from './config';
import { ChtError } from './errors';

const DEPLOYMENTS = ['chis-ke', 'chis-tg', 'chis-civ', 'chis-ml', 'chis-ug'];
const folders: string[] = [];

// a deployment folder with these files
function folder(files: Record<string, string>): string {
	const dir = mkdtempSync(join(tmpdir(), 'cht-iam-deployment-'));
	folders.push(dir);
	for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
	return dir;
}
const oneType = JSON.stringify({ contact_types: [{ name: 'c_unit' }] });

afterEach(() => {
	env.DEPLOYMENT_DIR = 'config/deployments/chis-ke';
	for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('the deployment folder', () => {
	it.each([
		['chis-ke', 'image/png', [0x89, 0x50, 0x4e, 0x47]],
		['chis-tg', 'image/png', [0x89, 0x50, 0x4e, 0x47]],
		['chis-civ', 'image/png', [0x89, 0x50, 0x4e, 0x47]],
		['chis-ml', 'image/png', [0x89, 0x50, 0x4e, 0x47]],
		['chis-ug', 'image/jpeg', [0xff, 0xd8, 0xff]]
	])('reads the %s logo file', (name, contentType, signature) => {
		env.DEPLOYMENT_DIR = `config/deployments/${name}`;
		const logo = deploymentLogo();
		expect(logo?.contentType).toBe(contentType);
		expect([...logo!.bytes.subarray(0, signature.length)]).toEqual(signature);
		expect(logo?.etag).toMatch(/^"[0-9a-f]{16}"$/);
	});

	it('gives each deployment its own logo, and none to a folder without one', () => {
		const etags = DEPLOYMENTS.map((name) => {
			env.DEPLOYMENT_DIR = `config/deployments/${name}`;
			return deploymentLogo()?.etag;
		});
		expect(new Set(etags).size).toBe(etags.length);
		env.DEPLOYMENT_DIR = folder({ 'config.json': oneType });
		expect(deploymentLogo()).toBeNull();
	});

	it('refuses a folder without usable contact types, naming the file', () => {
		expect(() => loadDeployment(folder({}))).toThrow(/config\.json is missing/);
		expect(() => loadDeployment(folder({ 'config.json': '{' }))).toThrow(/config\.json is not valid JSON/);
		expect(() => loadDeployment(folder({ 'config.json': '{"contact_types": []}' }))).toThrow(/needs a "contact_types" list/);
		const twice = JSON.stringify({ contact_types: [{ name: 'c_unit' }, { name: 'c_unit' }] });
		expect(() => loadDeployment(folder({ 'config.json': twice }))).toThrow(/lists the contact type "c_unit" twice/);
		const filtered = JSON.stringify({ contact_types: [{ name: 'c_unit', place_properties: [{ property_name: 'name', type: 'generated', parameter: '{{ contact.name | upcase }}' }] }] });
		expect(() => loadDeployment(folder({ 'config.json': filtered }))).toThrow(/the generated property "name" of "c_unit" can only use/);
		env.DEPLOYMENT_DIR = undefined;
		expect(() => getContactType('c_unit')).toThrow(/DEPLOYMENT_DIR is required/);
	});

	it('runs each type’s own hooks, in order, and never another type’s', async () => {
		const types = [
			{ name: 'c_unit', hooks: ['hooks/unit.mjs', 'hooks/tag.mjs'] },
			{ name: 'c_area', hooks: ['hooks/tag.mjs'] },
			{ name: 'c_other' }
		];
		env.DEPLOYMENT_DIR = folder({ 'config.json': JSON.stringify({ contact_types: types }) });
		mkdirSync(join(env.DEPLOYMENT_DIR, 'hooks'));
		writeFileSync(join(env.DEPLOYMENT_DIR, 'hooks/unit.mjs'), 'export async function mutate(draft) { draft.name += " Unit"; }');
		writeFileSync(join(env.DEPLOYMENT_DIR, 'hooks/tag.mjs'), 'export async function mutate(draft, { contactType }) { draft.name += ` (${contactType.name})`; }');
		await checkDeployment();

		const named = async (type: string) => {
			const draft = { contact_type: type, name: 'Kanyakwar' };
			await mutate(draft, { cht: {} as never, contactType: getContactType(type), isReplacement: false });
			return draft.name;
		};
		expect(await named('c_unit')).toBe('Kanyakwar Unit (c_unit)');
		expect(await named('c_area')).toBe('Kanyakwar (c_area)');
		expect(await named('c_other')).toBe('Kanyakwar');
	});

	it('refuses hooks that aren’t in the folder, or don’t export mutate', async () => {
		const listing = (hooks: unknown) => JSON.stringify({ contact_types: [{ name: 'c_unit', hooks }] });
		expect(() => loadDeployment(folder({ 'config.json': listing(['gone.mjs']) }))).toThrow(/the hook "gone.mjs" of "c_unit" isn't in/);
		expect(() => loadDeployment(folder({ 'config.json': listing('hook.mjs') }))).toThrow(/"hooks" of "c_unit" must be a list of files/);

		env.DEPLOYMENT_DIR = folder({ 'config.json': listing(['hook.mjs']), 'hook.mjs': 'export const other = 1;' });
		await expect(checkDeployment()).rejects.toThrow(/hook\.mjs must export a "mutate" function/);
	});

	it('refuses the write with a hook’s own error, but keeps CHT failures as they are', async () => {
		const types = [{ name: 'c_unit', hooks: ['refuse.mjs'] }, { name: 'c_area', hooks: ['cht.mjs'] }, { name: 'c_bare', hooks: ['bare.mjs'] }];
		env.DEPLOYMENT_DIR = folder({
			'config.json': JSON.stringify({ contact_types: types }),
			'refuse.mjs': 'export async function mutate() { throw new Error("CHU does not exist"); }',
			'cht.mjs': 'export async function mutate(draft, { cht }) { await cht.docsAtDepth(draft.parent, [0]); }',
			'bare.mjs': 'export async function mutate() { throw new Error(); }'
		});
		const run = (type: string, cht: unknown = {}) =>
			mutate({ contact_type: type, parent: 'p' }, { cht: cht as never, contactType: getContactType(type), isReplacement: false });

		await expect(run('c_unit')).rejects.toMatchObject({ status: 422, code: 'HOOK_FAILED', message: 'CHU does not exist', details: { hook: 'refuse.mjs' } });
		await expect(run('c_bare')).rejects.toMatchObject({ code: 'HOOK_FAILED', message: 'bare.mjs refused the place' });
		const down = new ChtError(503, 'unavailable');
		await expect(run('c_area', { docsAtDepth: async () => Promise.reject(down) })).rejects.toBe(down);
	});

	it('keeps Kenya’s rules in its hooks: unit names, and CHP areas copying their unit’s facility', () => {
		expect(getContactType('c_community_health_unit').hooks).toEqual(['hooks/unit-name.mjs']);
		expect(getContactType('d_community_health_volunteer_area').hooks).toEqual(['hooks/copy-unit-facility.mjs']);
		expect(getContactType('e_household').hooks).toBeUndefined();
	});
});

describe('getContactType', () => {
	it('allows every action for a type that lists none, and only the listed ones otherwise', () => {
		for (const action of ['create', 'replace', 'move', 'merge', 'delete'] as const) {
			expect(getContactType('c_community_health_unit', action).name).toBe('c_community_health_unit');
		}
		expect(getContactType('e_household', 'move').friendly).toBe('Household');
		expect(getContactType('e_household').friendly).toBe('Household');
		expect(() => getContactType('e_household', 'create')).toThrow("Household places can't be created here");
		expect(() => getContactType('e_household', 'delete')).toThrow(expect.objectContaining({ status: 422, code: 'ACTION_NOT_ALLOWED' }));
	});
});
