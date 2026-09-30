import { z } from 'zod';

// CouchDB reserves ids starting with "_"
export const docId = z
	.string()
	.min(1)
	.max(256)
	.refine((id) => !id.startsWith('_'), 'must not start with "_"');

const propertyValues = z.record(z.string(), z.union([z.string(), z.array(z.string())]));

export const createRequest = z
	.object({
		contactType: z.string().min(1),
		parentId: docId,
		place: propertyValues.default({}),
		contact: z.object({ id: docId, properties: propertyValues.optional() }).strict(),
		user: z.object({ roles: z.array(z.string().min(1)).min(1) }).strict().optional(),
		ignoreWarnings: z.boolean().default(false)
	})
	.strict();

// APP.md → Replace: contact with properties is a new person; with only an id, an existing person
// taking over with their login. No duplicate check, so no ignoreWarnings.
export const replaceRequest = z
	.object({
		contactType: z.string().min(1),
		contact: z.object({ id: docId, properties: propertyValues.optional() }).strict(),
		scope: z.enum(['all', 'place']).default('all'),
		place: propertyValues.default({}),
		user: z.object({ roles: z.array(z.string().min(1)).min(1) }).strict().optional()
	})
	.strict();

export const batchRequest = z
	.object({
		items: z
			.array(
				z.discriminatedUnion('op', [
					z.object({ op: z.literal('create'), placeId: docId, body: createRequest }).strict(),
					z.object({ op: z.literal('replace'), placeId: docId, body: replaceRequest }).strict()
				])
			)
			.min(1)
	})
	.strict();

export type CreateRequest = z.infer<typeof createRequest>;
export type ReplaceRequest = z.infer<typeof replaceRequest>;
export type BatchRequest = z.infer<typeof batchRequest>;
