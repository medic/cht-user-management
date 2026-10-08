import type { Warning } from '../places/unique';

// A staged item: a complete request waiting in the user's staged list (APP.md → Staged list → Items)

export const STAGED_KINDS = ['create', 'replace', 'move', 'merge', 'delete'] as const;
export type StagedKind = (typeof STAGED_KINDS)[number];

export const STAGED_STATUSES = [
  'pending',
  'validating',
  'invalid',
  'needs_confirmation',
  'ready',
  'uploading',
  'created',
  'failed'
] as const;
export type StagedStatus = (typeof STAGED_STATUSES)[number];

export type Confirmation =
  | { reason: 'duplicates'; warnings: Warning[] }
  | { reason: 'large_move'; counts: Record<string, number> }
  | { reason: 'typed_name'; expected: string };

export type StagedItem = {
  id: string;
  kind: StagedKind;
  // exactly the request the upload sends, including its client-chosen ids
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- one of the kinds' requests, each checked by its own schema
  request: Record<string, any>;
  source: { type: 'form' } | { type: 'csv'; file: string; row: number };
  // CSV rows only: the row as uploaded
  raw?: Record<string, string>;
  status: StagedStatus;
  errors?: Record<string, string>;
  confirmation?: Confirmation;
  // another place for a person another item creates: that item, which uploads first
  // (APP.md → One person, many places)
  dependsOn?: string;
  // CSV rows: whether the background run has looked its places up in CHT yet
  checkedWithCht?: boolean;
  // what the list shows: worked out when the item is added, since the request only holds ids
  // target: a merge's destination, or a move's new parent, shown as a link where its name appears
  // in `person`
  summary: { title: string; subtitle?: string; person?: string; target?: { placeId: string; name: string } };
  // the operation's response, once uploaded
  result?: Record<string, unknown>;
  // the upload that last sent it: the list groups uploaded items by this
  upload?: { runId: string; startedAt: string };
  // replace items: every place the item hands over. Only one waiting item may hand over a place.
  // delete items: the place, then every place above it.
  claims?: string[];
  // move items: the new parent, then every place above it
  targets?: string[];
  // delete and move items, once uploaded: the job they scheduled, as it stands (not stored)
  job?: Record<string, unknown>;
  // why the last upload failed
  failure?: { code: string; message: string; details?: Record<string, unknown> };
  revision: number;
  // the order items were added in: the list shows them in this order
  sequence: number;
  createdAt: string;
  updatedAt: string;
};

// Whose list: every key includes both, so one user's items can't be read through another's
export type ListOwner = { instanceId: string; username: string };

export type StatusCounts = Partial<Record<StagedStatus, number>>;
