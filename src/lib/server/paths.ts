import { resolve, sep } from 'node:path';

// A path inside base, built from parts such as a job id or a doc id. Refused when the parts would
// lead to base itself or outside it, eg. an id of "..", "../app" or "a/../../b", so that nothing is
// ever deleted or written outside the folder it belongs to
export function within(base: string, ...parts: string[]): string {
	const root = resolve(base);
	const path = resolve(root, ...parts);
	if (!path.startsWith(root + sep)) {
		throw new Error(`"${parts.join('/')}" would lead outside ${base}`);
	}
	return path;
}
