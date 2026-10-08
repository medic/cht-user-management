import { getContactType, type ContactProperty, type ContactType } from '../config';
import { ApiError } from '../errors';
import { toErrorBody } from '../http';
import { formatValue } from '../../validation/validators';
import type { OperationContext } from './context';
import { createPlace } from './create';
import { replacePrimaryContact } from './replace';
import type { BatchRequest } from './schemas';
import { duplicateWarning, normalize, type Warning } from './unique';
import { contactRef } from './documents';

type Item = BatchRequest['items'][number];
export type BatchItemResult = { placeId: string; status: number; body: unknown };

// legacy UPLOAD_BATCH_SIZE
const CONCURRENCY = 15;

// POST /api/v2/places/batch — each item runs exactly like its single endpoint; creates whose parent
// is created by another item run after it, mirroring legacy doUpload's independents-then-dependents
export async function runBatch(
  context: OperationContext,
  request: BatchRequest,
  maxItems: number,
  // called as each item finishes, in whatever order they finish
  onResult?: (index: number, result: BatchItemResult) => Promise<void> | void
): Promise<{ results: BatchItemResult[] }> {
  const { items } = request;
  if (items.length > maxItems) {
    throw new ApiError(413, 'BATCH_TOO_LARGE', `a batch may contain at most ${maxItems} items`, { maxItems });
  }

  const createIndex = new Map<string, number>();
  items.forEach((item, index) => {
    if (item.op !== 'create') {
      return;
    }
    if (createIndex.has(item.placeId)) {
      throw new ApiError(400, 'DUPLICATE_ITEM', `more than one create item for place "${item.placeId}"`, { placeId: item.placeId });
    }
    createIndex.set(item.placeId, index);
  });

  const results: (BatchItemResult | undefined)[] = new Array(items.length);
  const settle = async (index: number, result: BatchItemResult) => {
    results[index] = result;
    await onResult?.(index, result);
  };
  // a replace updates the outgoing person's account too: that's the place's current contact
  const replacedIds = items.filter((item) => item.op === 'replace').map((item) => item.placeId);
  const replaced = replacedIds.length ? await context.cht.getDocs(replacedIds) : [];
  const outgoing = new Map(replaced.map((doc) => [doc._id, contactRef(doc.contact)]));
  const { requires, after } = dependencies(items, createIndex, outgoing);
  const depth = depths(requires, after);
  const warnings = batchWarnings(items);

  const maxDepth = Math.max(...depth.filter((d) => d !== undefined).map(Number), 0);
  for (const [index, d] of depth.entries()) {
    if (d === undefined) {
      await settle(
        index,
        errorResult(items[index], new ApiError(422, 'DEPENDENCY_CYCLE', 'parentId refers back to this item through other items'))
      );
    }
  }

  for (let level = 0; level <= maxDepth; level++) {
    const indexes = depth.flatMap((d, index) => (d === level ? [index] : []));
    await withConcurrency(indexes, CONCURRENCY, async (index) => {
      const failed = requires[index].find((dependency) => results[dependency.index] && results[dependency.index]!.status >= 300);
      if (failed) {
        const message =
          failed.reason === 'parent'
            ? `parent item "${items[failed.index].placeId}" failed`
            : `item "${items[failed.index].placeId}", which creates person "${failed.contactId}", failed`;
        await settle(
          index,
          errorResult(
            items[index],
            new ApiError(424, 'DEPENDENCY_FAILED', message, { reason: failed.reason, placeId: items[failed.index].placeId })
          )
        );
        return;
      }
      await settle(index, await runItem({ ...context, extraWarnings: warnings[index] }, items[index]));
    });
  }

  return { results: results as BatchItemResult[] };
}

type Dependency = { index: number; reason: 'parent' | 'person'; contactId?: string };

// What each item waits for. `requires`: a create writing its parent, or the create writing its
// person (the one sending contact.properties), which must succeed first. `after`: only for ordering.
// Items that update the same account run one after another (APP.md → One person, many places, and
// Replace), since each sends that account's whole place list: creates for the same person, and
// replaces sharing an incoming or an outgoing person.
function dependencies(items: Item[], createIndex: Map<string, number>, outgoing: Map<string, string | undefined>) {
  const requires: Dependency[][] = items.map(() => []);
  const after: number[][] = items.map(() => []);
  const writes = (index: number) => {
    const item = items[index];
    return item.op === 'create' && !!item.body.contact.properties;
  };

  const byAccount = new Map<string, number[]>();
  const touch = (contactId: string | undefined, index: number) => {
    if (contactId) byAccount.set(contactId, [...(byAccount.get(contactId) ?? []), index]);
  };
  items.forEach((item, index) => {
    if (item.op === 'create') {
      const parent = createIndex.get(item.body.parentId);
      if (parent !== undefined) {
        requires[index].push({ index: parent, reason: 'parent' });
      }
      touch(item.body.contact.id, index);
    } else {
      touch(item.body.contact.id, index);
      const outgoingId = outgoing.get(item.placeId);
      if (outgoingId !== item.body.contact.id) touch(outgoingId, index);
    }
  });

  // one order for every account, the items writing a person first, so no two chains cross
  const rank = (index: number) => (writes(index) ? -1 : 0);
  for (const [contactId, indexes] of byAccount) {
    if (indexes.length < 2) {
      continue;
    }
    const ordered = [...indexes].sort((a, b) => rank(a) - rank(b) || a - b);
    const writer = ordered.find(writes);
    ordered.forEach((index, position) => {
      if (position === 0) {
        return;
      }
      after[index].push(ordered[position - 1]);
      if (writer !== undefined && items[index].op === 'create') {
        requires[index].push({ index: writer, reason: 'person', contactId });
      }
    });
  }
  return { requires, after };
}

async function runItem(context: OperationContext, item: Item): Promise<BatchItemResult> {
  try {
    const result =
      item.op === 'create'
        ? await createPlace(context, item.placeId, item.body)
        : await replacePrimaryContact(context, item.placeId, item.body);
    return { placeId: item.placeId, status: result.status, body: result.body };
  } catch (e) {
    return errorResult(item, e);
  }
}

function errorResult(item: Item, error: unknown): BatchItemResult {
  const { status, body } = toErrorBody(error);
  return { placeId: item.placeId, status, body };
}

// One more than the deepest item it waits for; undefined when its dependencies loop back on themselves
function depths(requires: Dependency[][], after: number[][]): (number | undefined)[] {
  const known = new Map<number, number | undefined>();
  const visiting = new Set<number>();
  const depthOf = (index: number): number | undefined => {
    if (known.has(index)) {
      return known.get(index);
    }
    if (visiting.has(index)) {
      return undefined;
    }
    visiting.add(index);
    let depth: number | undefined = 0;
    for (const dependency of [...requires[index].map((d) => d.index), ...after[index]]) {
      const below = depthOf(dependency);
      depth = below === undefined || depth === undefined ? undefined : Math.max(depth, below + 1);
    }
    visiting.delete(index);
    known.set(index, depth);
    return depth;
  };
  return requires.map((_, index) => depthOf(index));
}

async function withConcurrency<T>(values: T[], limit: number, run: (value: T) => Promise<void>): Promise<void> {
  for (let start = 0; start < values.length; start += limit) {
    await Promise.all(values.slice(start, start + limit).map(run));
  }
}

// Ported from warnings/: duplicate unique values between items of the batch, and several items
// replacing the same place. Items compare against each other here; each item compares against CHT itself.
export function batchWarnings(items: Item[]): Warning[][] {
  const warnings: Warning[][] = items.map(() => []);
  const groups = new Map<string, { indexes: number[]; warning: Warning }>();

  const addToGroup = (key: string, index: number, warning: Warning) => {
    const group = groups.get(key) ?? { indexes: [], warning };
    group.indexes.push(index);
    groups.set(key, group);
  };

  items.forEach((item, index) => {
    const contactType = tryContactType(item.body.contactType);
    if (!contactType) {
      return;
    }

    const parentScope = item.op === 'create' ? item.body.parentId : undefined;
    const sections: [string, ContactProperty[], Record<string, string | string[]>][] = [
      ['place', contactType.place_properties, item.body.place],
      ['contact', contactType.contact_properties, item.body.contact.properties ?? {}]
    ];
    for (const [section, properties, values] of sections) {
      for (const property of properties.filter((p) => p.unique)) {
        const raw = values[property.property_name];
        const value = Array.isArray(raw) ? raw.join(' ') : raw;
        if (!value || (property.unique === 'parent' && !parentScope)) {
          continue;
        }
        const scope = property.unique === 'parent' ? parentScope : '*';
        const key = `unique|${contactType.name}|${section}|${property.property_name}|${scope}|${normalize(formatValue(property, value))}`;
        addToGroup(key, index, duplicateWarning(property));
      }
    }

    if (item.op === 'replace') {
      addToGroup(`replace|${item.placeId}`, index, { message: `Multiple entries are replacing the same "${contactType.friendly}"` });
    }
  });

  for (const { indexes, warning } of groups.values()) {
    if (indexes.length > 1) {
      indexes.forEach((index) => warnings[index].push(warning));
    }
  }
  return warnings;
}

function tryContactType(name: string): ContactType | undefined {
  try {
    return getContactType(name);
  } catch {
    return undefined;
  }
}
