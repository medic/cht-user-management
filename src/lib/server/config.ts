import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { env } from '$env/dynamic/private';

import { allowsAction, type Action, type ContactType, type HierarchyConstraint } from '../config-types';
import type { Cht } from './cht/client';

import { templateProblem, VALIDATION_VERSION } from '../validation';
import { ApiError, ChtError } from './errors';

// The shapes are shared with the browser, which validates with the same config
export {
  ACTIONS,
  PROPERTY_TYPES,
  allowsAction,
  hasMultipleRoles,
  type Action,
  type ContactProperty,
  type ContactType,
  type HierarchyConstraint,
  type PropertyType
} from '../config-types';

export type ConfigSystem = {
  contact_types: ContactType[];
};

// The fields written onto a place doc before lineage and attribution are added
export type PlaceDraft = {
  contact_type: string;
  parent?: string;
  name?: string;
  [property: string]: unknown;
};

export type MutateContext = { cht: Cht; contactType: ContactType; isReplacement: boolean };
export type Mutate = (draft: PlaceDraft, context: MutateContext) => Promise<void>;

export type Logo = { contentType: string; bytes: Uint8Array<ArrayBuffer>; etag: string };

// A deployment is one folder, named by DEPLOYMENT_DIR (APP.md → What drives it: contact types):
//   config.json     its contact types
//   instances.json  the CHT instances users sign in to (read by settings.ts)
//   logo.png        optional: or logo.jpg, logo.svg, logo.webp
// and any hook scripts its contact types list (see `hooks` below)
export const DEPLOYMENT_FILES = { config: 'config.json', instances: 'instances.json' } as const;
const LOGOS: Record<string, string> = {
  'logo.png': 'image/png',
  'logo.jpg': 'image/jpeg',
  'logo.jpeg': 'image/jpeg',
  'logo.svg': 'image/svg+xml',
  'logo.webp': 'image/webp'
};

type Deployment = { dir: string; config: ConfigSystem; logo: Logo | null; version: string; hooks: Map<string, Promise<Mutate>> };

const loaded = new Map<string, Deployment>();
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex').slice(0, 16);

// Reads the folder's contact types and logo. Throws, naming the file, when they can't be used
export function loadDeployment(dir: string): Deployment {
  const path = join(dir, DEPLOYMENT_FILES.config);
  let config: ConfigSystem;
  try {
    config = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`${path} ${existsSync(path) ? `is not valid JSON: ${(e as Error).message}` : 'is missing'}`);
  }
  const types = config?.contact_types;
  if (!Array.isArray(types) || !types.length || types.some((type) => typeof type?.name !== 'string')) {
    throw new Error(`${path} needs a "contact_types" list, each with a "name"`);
  }
  const names = types.map((type) => type.name);
  const repeated = names.find((name, i) => names.indexOf(name) !== i);
  if (repeated) {
    throw new Error(`${path} lists the contact type "${repeated}" twice`);
  }
  for (const type of types) {
    for (const property of [...(type.place_properties ?? []), ...(type.contact_properties ?? [])]) {
      const problem = property.type === 'generated' ? templateProblem(property.parameter) : undefined;
      if (problem) {
        throw new Error(`${path}: the generated property "${property.property_name}" of "${type.name}" ${problem}`);
      }
    }
    const hooks: unknown = type.hooks;
    if (hooks !== undefined && (!Array.isArray(hooks) || hooks.some((file) => typeof file !== 'string'))) {
      throw new Error(`${path}: "hooks" of "${type.name}" must be a list of files`);
    }
    const missing = (type.hooks ?? []).find((file) => !existsSync(join(dir, file)));
    if (missing) {
      throw new Error(`${path}: the hook "${missing}" of "${type.name}" isn't in ${dir}`);
    }
  }

  const logoFile = Object.keys(LOGOS).find((file) => existsSync(join(dir, file)));
  const bytes = logoFile ? new Uint8Array(readFileSync(join(dir, logoFile))) : undefined;
  const logo = logoFile && bytes?.length ? { contentType: LOGOS[logoFile], bytes, etag: `"${hash(bytes)}"` } : null;

  // changes whenever the contact types or the validation rules change (docs/api-contract.md §3)
  const version = `sha256:${createHash('sha256').update(VALIDATION_VERSION).update(JSON.stringify(types)).digest('hex').slice(0, 16)}`;
  return { dir, config, logo, version, hooks: new Map() };
}

// The deployment in DEPLOYMENT_DIR, read once
export function deployment(): Deployment {
  if (!env.DEPLOYMENT_DIR) {
    throw new Error("DEPLOYMENT_DIR is required: the folder with the deployment's config.json and instances.json");
  }
  const dir = resolve(env.DEPLOYMENT_DIR);
  let match = loaded.get(dir);
  if (!match) {
    match = loadDeployment(dir);
    loaded.set(dir, match);
  }
  return match;
}

// A hook script from the deployment's folder, imported once. It must export a `mutate` function
function hook(current: Deployment, file: string): Promise<Mutate> {
  let loading = current.hooks.get(file);
  if (!loading) {
    const path = join(current.dir, file);
    loading = import(/* @vite-ignore */ pathToFileURL(path).href).then((module) => {
      if (typeof module.mutate !== 'function') {
        throw new Error(`${path} must export a "mutate" function`);
      }
      return module.mutate as Mutate;
    });
    current.hooks.set(file, loading);
  }
  return loading;
}

// Reads everything up front, every hook included, so a broken deployment stops the server at startup
export async function checkDeployment(): Promise<void> {
  const current = deployment();
  await Promise.all(current.config.contact_types.flatMap((type) => (type.hooks ?? []).map((file) => hook(current, file))));
}

// The deployment's logo, or null when its folder has none
export function deploymentLogo(): Logo | null {
  return deployment().logo;
}

// The type, and with an action, only when the type allows it (APP.md → What drives it: contact types)
export function getContactType(name: string, action?: Action): ContactType {
  const contactType = deployment().config.contact_types.find((type) => type.name === name);
  if (!contactType) {
    throw new ApiError(404, 'UNKNOWN_CONTACT_TYPE', `unrecognized contact type "${name}"`);
  }
  if (action && !allowsAction(contactType, action)) {
    throw new ApiError(422, 'ACTION_NOT_ALLOWED', `${contactType.friendly} places can't be ${PAST[action]} here`, { action });
  }
  return contactType;
}

const PAST: Record<Action, string> = { create: 'created', replace: 'replaced', move: 'moved', merge: 'merged', delete: 'deleted' };

// A place type's display name: a contact type's `friendly`, or a hierarchy level's `friendly_name`
// for types that only appear above others, eg. sub counties; else the type itself
export function friendlyTypeName(type: string): string {
  const types = deployment().config.contact_types;
  return (
    types.find((t) => t.name === type)?.friendly ??
    types.flatMap((t) => t.hierarchy).find((level) => level.contact_type === type)?.friendly_name ??
    type
  );
}

export function getParentLevel(contactType: ContactType): HierarchyConstraint {
  const parent = contactType.hierarchy.find((level) => level.level === 1);
  if (!parent) {
    throw new Error(`contact type "${contactType.name}" has no level 1 hierarchy`);
  }
  return parent;
}

// The place's contact type's hooks, one after the other (APP.md → Deployment hooks). A hook that
// throws refuses the write with its own message; CHT failing under it stays a CHT failure, safe to retry
export async function mutate(draft: PlaceDraft, context: MutateContext): Promise<void> {
  const current = deployment();
  for (const file of context.contactType.hooks ?? []) {
    const run = await hook(current, file);
    try {
      await run(draft, context);
    } catch (e) {
      if (e instanceof ApiError || e instanceof ChtError) throw e;
      throw new ApiError(422, 'HOOK_FAILED', e instanceof Error && e.message ? e.message : `${file} refused the place`, { hook: file });
    }
  }
}

export function configVersion(): string {
  return deployment().version;
}

export function assertConfigVersion(sent: string | null): void {
  if (sent && sent !== configVersion()) {
    throw new ApiError(409, 'CONFIG_CHANGED', 'The configuration was updated. Reload the page to use the new rules.');
  }
}
