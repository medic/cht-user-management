import { z } from 'zod';

import { ApiError } from '../errors';
import type { OperationContext } from '../places/context';
import { prepareReplace, type PreparedReplace } from '../places/replace';
import { docId, replaceRequest, type ReplaceRequest } from '../places/schemas';
import type { StagedItem } from './types';

// Replace items in the staged list (APP.md → Replace Existing Users, and Staged list)

export const replaceItemRequest = replaceRequest.extend({ placeId: docId });
export type ReplaceItemRequest = z.infer<typeof replaceItemRequest>;

export function parseReplaceItem(request: unknown): ReplaceItemRequest {
	const parsed = replaceItemRequest.safeParse(request);
	if (!parsed.success) {
		throw new ApiError(400, 'INVALID_REQUEST', 'request does not match the expected shape', {
			issues: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
		});
	}
	return parsed.data;
}

const waiting = (item: StagedItem) => item.status !== 'created';

// The replace's own checks, then the list's: only one handover of a place can wait in the list,
// since uploading both would have the second undo the first. `claims`: every place this item hands
// over, which no other waiting replace item may also hand over.
export async function stageReplace(
	context: OperationContext,
	request: ReplaceItemRequest,
	all: StagedItem[],
	self?: string
): Promise<{ summary: StagedItem['summary']; claims: string[]; prepared: PreparedReplace }> {
	const { placeId, ...body } = request;
	const prepared = await prepareReplace(context, placeId, body as ReplaceRequest);
	if (prepared.state === 'nothing_to_do') {
		throw new ApiError(409, 'NOTHING_TO_CHANGE', `${prepared.incoming.doc?.name ?? 'This person'} already has ${prepared.placeDoc.name}, as its primary contact and in their login.`);
	}
	const claims = [placeId, ...prepared.affectedPlaceIds];

	const others = all.filter((item) => item.id !== self && item.kind === 'replace' && waiting(item));
	const clash = others.find((item) => (item.claims ?? [item.request.placeId]).some((id) => claims.includes(id)));
	if (clash) {
		const same = clash.request.placeId === placeId;
		throw new ApiError(
			409,
			'HANDOVER_ALREADY_STAGED',
			same
				? `"${clash.summary.title}" is already being replaced by another item in your staged list. Remove or change that one first.`
				: `This hands over a place that another item in your staged list also hands over ("${clash.summary.title}"). Remove or change one of them.`,
			{ itemId: clash.id }
		);
	}

	return { summary: summarizeReplace(prepared), claims, prepared };
}

// "Kanyakwar", "County › Subcounty", "Mary Atieno → Grace Owino"
function summarizeReplace(prepared: PreparedReplace): StagedItem['summary'] {
	const { placeDoc, ancestors, outgoing, incoming, built } = prepared;
	const incomingName = incoming.kind === 'existing' ? String(incoming.doc.name ?? '') : String(built.contact.name ?? incoming.doc?.name ?? '');
	const outgoingName = outgoing.doc?.name ? String(outgoing.doc.name) : undefined;
	const location = ancestors
		.map((doc) => doc?.name)
		.filter((name): name is string => typeof name === 'string' && name.length > 0)
		.reverse()
		.join(' › ');
	const places = 1 + prepared.affectedPlaceIds.length;
	return {
		title: String(built.place.name ?? placeDoc.name ?? 'Unnamed place') + (places > 1 ? ` and ${places - 1} more` : ''),
		subtitle: location || undefined,
		person: outgoingName ? `${outgoingName} → ${incomingName}` : incomingName || undefined
	};
}
