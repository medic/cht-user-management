// The contact-type configuration shape, shared by the server and the browser, which both validate
// with it (APP.md → What drives it: contact types)

export const PROPERTY_TYPES = [
	'dob',
	'generated',
	'name',
	'none',
	'phone',
	'regex',
	'string',
	'select_one',
	'select_multiple'
] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

// What can be done with a type's places. A type lists its actions, or allows all of them
export const ACTIONS = ['create', 'replace', 'move', 'merge', 'delete'] as const;
export type Action = (typeof ACTIONS)[number];

export type ContactProperty = {
	friendly_name: string;
	property_name: string;
	type: PropertyType;
	required: boolean;
	parameter?: string | string[] | Record<string, string>;
	errorDescription?: string;
	unique?: 'all' | 'parent';
};

export type HierarchyConstraint = ContactProperty & {
	contact_type: string;
	level: number;
};

export type ContactType = {
	name: string;
	friendly: string;
	contact_type: string;
	contact_friendly?: string;
	user_role: string[];
	username_from_place: boolean;
	hierarchy: HierarchyConstraint[];
	replacement_property: ContactProperty;
	place_properties: ContactProperty[];
	contact_properties: ContactProperty[];
	deactivate_users_on_replace: boolean;
	can_assign_multiple?: boolean;
	// the only actions offered for the type; every action when left out
	actions?: Action[];
	// server only: scripts in the deployment's folder, run in order on each place before it's written
	hooks?: string[];
};

export function allowsAction(contactType: ContactType, action: Action): boolean {
	return !contactType.actions || contactType.actions.includes(action);
}

export function hasMultipleRoles(contactType: ContactType): boolean {
	return contactType.user_role.length > 1;
}
