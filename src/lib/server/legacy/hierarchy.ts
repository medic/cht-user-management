import { randomUUID } from 'node:crypto';

import type { Instance } from '../auth/instances';
import { baseUrl } from '../auth/instances';
import type { ContactType } from '../config';
import { deleteRequest } from '../hierarchy/delete';
import { mergeRequest } from '../hierarchy/merge';
import { moveRequest } from '../hierarchy/move';
import { scheduleJob, type JobDeps } from '../hierarchy/service';
import { readForm } from './form';
import { errorString, legacyContactType } from './http';
import { hierarchyErrors, resolveHierarchy, type Resolved } from './resolver';

// POST /api/v1/manage-hierarchy { op, place_type, source_…, destination_… }: the previous version's
// way to schedule a move, merge or delete, naming each place by its hierarchy. It schedules the same
// job as v2. The old endpoint had no typed confirmation, so the place's own name is given for it.

const ACTIONS = ['move', 'merge', 'delete'] as const;
type Action = (typeof ACTIONS)[number];

export type ManageHierarchyResult =
  { jobName: string; action: Action; instanceUrl: string; sourceId: string; destinationId: string } | { error: string };

export async function manageHierarchy(deps: JobDeps, instance: Instance, body: Record<string, unknown>): Promise<ManageHierarchyResult> {
  const contactType = legacyContactType(body.place_type);
  try {
    const action = parseAction(body.op);
    const source = await resolveLineage(deps, contactType, body, 'source_');
    const destination = action === 'delete' ? [] : await resolveLineage(deps, contactType, body, 'destination_');
    const { sourceId, destinationId } = sourceAndDestination(action, source, destination);

    const common = { kind: action, contactType: contactType.name };
    const request =
      action === 'move'
        ? moveRequest.parse({ ...common, placeId: sourceId, newParentId: destinationId })
        : action === 'merge'
          ? mergeRequest.parse({ ...common, sourceId, destinationId, confirmName: source[0]!.name.original })
          : deleteRequest.parse({ ...common, placeId: sourceId, confirmName: source[0]!.name.original });
    await scheduleJob(deps, randomUUID(), request);

    return {
      jobName: jobName(action, source, destination),
      action,
      instanceUrl: baseUrl(instance).replace(/\/$/, ''),
      sourceId,
      destinationId
    };
  } catch (e) {
    return { error: errorString(e) };
  }
}

function parseAction(action: unknown = ''): Action {
  if (!ACTIONS.includes(action as Action)) {
    throw new Error(`invalid action: "${action}"`);
  }
  return action as Action;
}

// The place and the places above it, from the levels named after `prefix`; the first level that
// can't be found is the error
async function resolveLineage(deps: JobDeps, contactType: ContactType, body: Record<string, unknown>, prefix: string): Promise<Resolved> {
  const names = readForm(body, contactType, prefix).hierarchy;
  const resolved = await resolveHierarchy(deps.cht, deps.session, contactType, names);
  const [firstError] = Object.values(hierarchyErrors(contactType, names, resolved, prefix));
  if (firstError) {
    throw new Error(firstError);
  }
  return resolved;
}

function sourceAndDestination(action: Action, source: Resolved, destination: Resolved): { sourceId: string; destinationId: string } {
  const sourceId = source[0]?.id;
  if (!sourceId) {
    throw new Error('Unexpected error: Hierarchy operation failed due to missing source information');
  }
  if (action === 'delete') {
    return { sourceId, destinationId: '' };
  }

  // a move names the new parent; a merge, the place merged into
  const destinationId = destination[action === 'move' ? 1 : 0]?.id;
  if (!destinationId) {
    throw new Error('Unexpected error: Hierarchy operation failed due to missing destination information');
  }
  if (action === 'move' && destinationId === source[1]?.id) {
    throw new Error(`Place "${source[0]?.name.original}" already has "${destination[1]?.name.original}" as parent`);
  }
  if (action === 'merge' && destinationId === sourceId) {
    throw new Error('Cannot merge place with self');
  }
  return { sourceId, destinationId };
}

// eg. "move_[Kisumu.Kisumu West.Kanyakwar]_to_[Kisumu.Seme]": each lineage top level first
function jobName(action: Action, source: Resolved, destination: Resolved): string {
  const describe = (lineage: Resolved) =>
    [...lineage]
      .reverse()
      .filter((place) => !!place)
      .map((place) => place!.name.formatted)
      .join('.');
  const destinationDescription = describe(destination);
  return `${action}_[${describe(source)}]${destinationDescription && `_to_[${destinationDescription}]`}`;
}
