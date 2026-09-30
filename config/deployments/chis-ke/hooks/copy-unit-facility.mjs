// Kenya eCHIS, for CHP areas: a new area carries its unit's facility and the unit's own name and
// code, copied from the unit, or else from an area already under it.
//
// Hooks are listed per contact type in config.json, and run in order before a place is written, once
// it has passed validation (APP.md → Deployment hooks). Each gets the draft place doc to adjust in
// place, and a context: `cht`, the app's CHT client; `contactType`, the place's type from
// config.json; `isReplacement`, true when replacing its primary contact. Throwing an Error refuses
// the write, with the error's message.

/** @type {(draft: Record<string, any>, context: { cht: any; contactType: any; isReplacement: boolean }) => Promise<void>} */
export async function mutate(draft, { cht, contactType, isReplacement }) {
	if (isReplacement || !draft.parent) {
		return;
	}

	const parentType = contactType.hierarchy.find((level) => level.level === 1)?.contact_type;
	const docs = await cht.docsAtDepth(draft.parent, [0, 1]);
	const chu = docs.find((doc) => doc.contact_type === parentType);
	const sibling = docs.find((doc) => doc.contact_type === contactType.name);
	if (!chu && !sibling) {
		throw new Error('CHU does not exist');
	}

	const scrapeInto = (target, chpKey, chuKey = chpKey) => {
		const value = chu?.[chuKey] || sibling?.[chpKey];
		if (!value) {
			throw new Error(`eCHIS-KE logic cant find existing data for ${chpKey}`);
		}
		target[chpKey] = value;
	};

	scrapeInto(draft, 'link_facility_code');
	scrapeInto(draft, 'link_facility_name');
	scrapeInto(draft, 'chu_name', 'name');
	scrapeInto(draft, 'chu_code', 'code');
}
