import { randomUUID } from 'node:crypto';

import type { ContactProperty, ContactType, HierarchyConstraint } from '../../config-types';
import { buildProperties, resolveRoles, type PropertyInput, type ValidationErrors } from '../../validation';
import { formatValue } from '../../validation/validators';
import { getContactType } from '../config';
import { ApiError } from '../errors';
import { isWithinFacilities } from '../places/directory';
import { placeLookup } from '../places/lookup';
import { normalize } from '../places/unique';
import { resolveHierarchy, ROLES_COLUMN } from './csv';
import { parseReplaceItem, stageReplace } from './replace-items';
import type { StagedDeps } from './service';
import type { ListOwner, StagedItem } from './types';

// Replacing many from a CSV (APP.md → Replacing many (CSV))

export const USERNAME_COLUMN = 'Username';
export const SCOPE_COLUMN = 'Scope';

type Column = {
  header: string;
  required: boolean;
  level?: HierarchyConstraint;
  replacement?: true;
  username?: true;
  scope?: true;
  contact?: ContactProperty;
  roles?: true;
  place?: ContactProperty;
};

// The hierarchy top first, the place being replaced, Username and Scope when the type can share a
// person, the new person's properties, Roles when the type has several, then the place properties,
// all optional. A row fills in either Username or the person's properties.
export function replaceColumns(contactType: ContactType): Column[] {
  const columns: Column[] = [
    ...[...contactType.hierarchy]
      .sort((a, b) => b.level - a.level)
      .map((level) => ({ header: level.friendly_name, required: level.required, level })),
    { header: contactType.replacement_property.friendly_name, required: true, replacement: true as const }
  ];
  if (contactType.can_assign_multiple) {
    columns.push({ header: USERNAME_COLUMN, required: false, username: true }, { header: SCOPE_COLUMN, required: false, scope: true });
  }
  columns.push(
    ...contactType.contact_properties
      .filter((p) => p.type !== 'generated')
      .map((contact) => ({ header: contact.friendly_name, required: false, contact }))
  );
  if (contactType.user_role.length > 1) {
    columns.push({ header: ROLES_COLUMN, required: false, roles: true });
  }
  columns.push(
    ...contactType.place_properties
      .filter((p) => p.type !== 'generated')
      .map((place) => ({ header: place.friendly_name, required: false, place }))
  );
  return columns;
}

// Every row becomes a replace item. The checks that need nothing from CHT run now; the place, the
// hierarchy and any Username are looked up in the background.
export function stagedReplaceRow(
  contactType: ContactType,
  columns: Column[],
  row: Record<string, string>,
  source: { file: string; row: number; sequence: number; stagedAt: string }
): StagedItem {
  const names: Record<string, string> = {};
  const contact: PropertyInput = {};
  const place: PropertyInput = {};
  let replacement = '';
  let username = '';
  let scope = '';
  let roles: string[] | undefined;
  for (const column of columns) {
    const value = row[column.header]?.trim() ?? '';
    if (column.level) names[column.level.property_name] = value;
    if (column.replacement) replacement = value;
    if (column.username) username = value;
    if (column.scope) scope = value.toLowerCase();
    if (column.contact && value) contact[column.contact.property_name] = value;
    if (column.place && value) place[column.place.property_name] = value;
    if (column.roles && value) roles = value.split(/[\s,;]+/).filter(Boolean);
  }

  const errors: ValidationErrors = {};
  for (const level of contactType.hierarchy) {
    if (level.required && !names[level.property_name]) errors[`hierarchy.${level.property_name}`] = 'Is Required';
  }
  if (!replacement) errors.replacement = 'Is Required';
  if (scope && scope !== 'all' && scope !== 'place') errors.scope = 'Must be "all" or "place", or left empty for all';

  const existing = !!username;
  if (existing && Object.keys(contact).length) {
    errors['contact.id'] = `Fill in either ${USERNAME_COLUMN} or the new person's details, not both`;
  }
  // place properties only when given; generated ones are worked out once the place is known
  const built = buildProperties({ contactType, mode: 'replace', place, contact: existing ? undefined : contact, lineage: {} });
  for (const [path, message] of Object.entries(built.errors)) {
    const generated = contactType.place_properties.some((p) => p.type === 'generated' && `place.${p.property_name}` === path);
    if (!generated) errors[path] = message;
  }
  if (!existing) {
    const resolved = resolveRoles(contactType, roles);
    if (resolved.error) errors['user.roles'] = resolved.error;
  }

  const now = source.stagedAt;
  const invalid = Object.keys(errors).length > 0;
  return {
    id: randomUUID(),
    kind: 'replace',
    request: {
      contactType: contactType.name,
      // found in the background, by name
      placeId: '',
      contact: existing ? { id: '' } : { id: randomUUID(), properties: contact },
      ...(scope === 'place' || scope === 'all' ? { scope } : {}),
      place,
      ...(!existing && roles ? { user: { roles } } : {})
    },
    source: { type: 'csv', file: source.file, row: source.row },
    raw: row,
    status: invalid ? 'invalid' : 'pending',
    errors: invalid ? errors : undefined,
    summary: {
      title: replacement || `Row ${source.row}`,
      subtitle:
        [...contactType.hierarchy]
          .sort((a, b) => b.level - a.level)
          .map((l) => names[l.property_name])
          .filter(Boolean)
          .join(' › ') || undefined,
      person: `→ ${existing ? username : (built.contact.name ?? 'a new person')}`
    },
    revision: 0,
    sequence: source.sequence,
    createdAt: now,
    updatedAt: now
  };
}

// Which field a refusal from the replace's checks is about, so the row shows it next to that field
const PERSON_CODES = ['PERSON_NOT_FOUND', 'PERSON_NOT_ELIGIBLE', 'EXISTING_PERSON_NOT_ALLOWED', 'IDEMPOTENCY_CONFLICT'];

// The background checks for replace rows: the hierarchy and the place by name, from the same
// in-memory index as create rows, and each Username's account, read together; then the replace's
// own checks. Rows are checked in file order, so of two rows handing over the same place, the
// first is kept and the second flagged.
export async function validateReplaceItems(
  deps: StagedDeps,
  owner: ListOwner,
  items: StagedItem[],
  save: (item: StagedItem, change: Partial<StagedItem>) => Promise<void>
): Promise<void> {
  if (!items.length) {
    return;
  }
  const { cht, session } = deps.context;
  // each parent's places are read once for the whole file
  const places = placeLookup(cht);

  // every Username's account, in one request: user-settings docs hold the account's contact
  const usernames = [...new Set(items.map((item) => item.raw?.[USERNAME_COLUMN]?.trim()).filter((u): u is string => !!u))];
  const settings = usernames.length ? await cht.getDocs(usernames.map((u) => `org.couchdb.user:${u}`)) : [];
  const contactOf = new Map(
    settings.map((doc) => [String(doc.name ?? doc._id.replace('org.couchdb.user:', '')), doc.contact_id as string | undefined])
  );

  // the list as it stands, updated as rows resolve, so later rows see what earlier ones hand over
  const list = await deps.store.list(owner);

  for (const item of items) {
    const contactType = getContactType(item.request.contactType);
    const raw = item.raw ?? {};
    const names = Object.fromEntries(contactType.hierarchy.map((level) => [level.property_name, raw[level.friendly_name] ?? '']));
    const hierarchy = await resolveHierarchy(contactType, names, places, (doc) => isWithinFacilities(session, doc));
    const errors: ValidationErrors = { ...(item.errors ?? {}), ...hierarchy.errors };
    const request: StagedItem['request'] = { ...item.request };

    // the place being replaced, under the parent found above
    const replacement = raw[contactType.replacement_property.friendly_name]?.trim() ?? '';
    if (hierarchy.parent && replacement) {
      const wanted = normalize(formatValue(contactType.replacement_property, replacement));
      const matches = (await places.under(hierarchy.parent!._id, contactType.name)).filter(
        (doc) => normalize(formatValue(contactType.replacement_property, String(doc.name ?? ''))) === wanted
      );
      if (!matches.length) errors.replacement = `Can't find ${contactType.friendly} "${replacement}" under "${hierarchy.parent.name}"`;
      else if (matches.length > 1)
        errors.replacement = `Found ${matches.length} places called "${replacement}" under "${hierarchy.parent.name}"`;
      else request.placeId = matches[0]._id;
    }

    const username = raw[USERNAME_COLUMN]?.trim();
    if (username) {
      const contactId = contactOf.get(username);
      if (!contactId) errors['contact.id'] ??= `No account called "${username}"`;
      else request.contact = { id: contactId };
    }

    let change: Partial<StagedItem>;
    if (Object.keys(errors).length || !request.placeId) {
      change = { status: 'invalid', errors, request, summary: { ...item.summary, subtitle: hierarchy.path || item.summary.subtitle } };
    } else {
      try {
        const parsed = parseReplaceItem(request);
        const staged = await stageReplace(deps.context, parsed, list, item.id);
        change = { status: 'ready', errors: undefined, request: parsed, summary: staged.summary, claims: staged.claims };
      } catch (e) {
        if (!(e instanceof ApiError)) throw e;
        const refused: ValidationErrors =
          e.code === 'VALIDATION_FAILED'
            ? { ...(e.details as ValidationErrors) }
            : { [PERSON_CODES.includes(e.code) ? 'contact.id' : 'replacement']: e.message };
        change = {
          status: 'invalid',
          errors: refused,
          request,
          summary: { ...item.summary, subtitle: hierarchy.path || item.summary.subtitle }
        };
      }
    }
    const index = list.findIndex((other) => other.id === item.id);
    if (index >= 0) list[index] = { ...list[index], ...change };
    await save(item, change);
  }
}
