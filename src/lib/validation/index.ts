import { hasMultipleRoles, type ContactProperty, type ContactType } from '../config-types';
import { formatValue, validateValue } from './validators';

// Bump whenever validation rules change, so a browser running old rules is told to reload
export const VALIDATION_VERSION = '1';

export type PropertyInput = Record<string, string | string[]>;
export type PropertyValues = Record<string, string>;
export type ValidationErrors = Record<string, string>;

// Names of the places above the one being written, keyed by hierarchy property_name (plus
// `replacement` when replacing), for `generated` templates that read `lineage`
export type Lineage = Record<string, string>;

type Section = 'place' | 'contact';

export type BuildOptions = {
	contactType: ContactType;
	mode: 'create' | 'replace';
	place: PropertyInput;
	// omitted when the contact already exists and is not being written
	contact?: PropertyInput;
	lineage: Lineage;
	// values already on the docs, used when rendering generated properties during a replace
	existingPlace?: Record<string, unknown>;
	existingContact?: Record<string, unknown>;
};

export type BuiltProperties = {
	place: PropertyValues;
	contact: PropertyValues;
	errors: ValidationErrors;
};

// `generated` templates: each {{ place.x }}, {{ contact.x }} or {{ lineage.x }} is replaced by that
// value, or by nothing when there's none. Nothing else is template syntax, and a value is never read
// as a template itself
const PLACEHOLDER = /\{\{\s*(place|contact|lineage)\.([A-Za-z0-9_-]+)\s*\}\}/g;

// Why a template can't be used, eg. a filter or a tag; checked when the deployment is read
export function templateProblem(template: unknown): string | undefined {
	if (typeof template !== 'string') {
		return 'expects a string template as "parameter"';
	}
	const rest = template.replace(PLACEHOLDER, '');
	if (['{{', '}}', '{%', '%}'].some((mark) => rest.includes(mark))) {
		return 'can only use {{ place.… }}, {{ contact.… }} and {{ lineage.… }}, without filters or tags';
	}
}

export function renderTemplate(template: string, scope: { place: PropertyValues; contact: PropertyValues; lineage: Lineage }): string {
	return template.replace(PLACEHOLDER, (_match, section: keyof typeof scope, name: string) =>
		Object.hasOwn(scope[section], name) ? scope[section][name] : ''
	);
}

export function buildProperties(options: BuildOptions): BuiltProperties {
	const { contactType, mode } = options;
	const errors: ValidationErrors = {};

	rejectUnknownKeys(options.place, contactType.place_properties, 'place', contactType, errors);
	const place = readSection(options.place, contactType.place_properties, 'place', mode === 'create', mode === 'replace', errors);

	let contact: PropertyValues = {};
	if (options.contact) {
		rejectUnknownKeys(options.contact, contactType.contact_properties, 'contact', contactType, errors);
		contact = readSection(options.contact, contactType.contact_properties, 'contact', true, false, errors);
	}

	const scope = {
		place: { ...stringValues(options.existingPlace, contactType.place_properties), ...place },
		contact: { ...stringValues(options.existingContact, contactType.contact_properties), ...contact },
		lineage: options.lineage
	};
	generate(contactType.place_properties, 'place', place, scope, errors);
	if (options.contact) {
		generate(contactType.contact_properties, 'contact', contact, scope, errors);
	}

	return { place, contact, errors };
}

export function resolveRoles(contactType: ContactType, requested: string[] | undefined): { roles: string[]; error?: string } {
	const invalid = (requested ?? []).filter((role) => !contactType.user_role.includes(role));
	if (invalid.length) {
		return { roles: [], error: `Invalid values for property "Roles": ${invalid.join(', ')}` };
	}

	if (!hasMultipleRoles(contactType)) {
		return { roles: contactType.user_role };
	}

	if (!requested?.length) {
		return { roles: [], error: 'Is Required' };
	}
	return { roles: [...new Set(requested)] };
}

function rejectUnknownKeys(
	input: PropertyInput,
	properties: ContactProperty[],
	section: Section,
	contactType: ContactType,
	errors: ValidationErrors
) {
	for (const key of Object.keys(input)) {
		const property = properties.find((p) => p.property_name === key);
		if (!property) {
			errors[`${section}.${key}`] = `is not a property of "${contactType.name}"`;
		} else if (property.type === 'generated') {
			errors[`${section}.${key}`] = 'is generated and cannot be set';
		}
	}
}

function readSection(
	input: PropertyInput,
	properties: ContactProperty[],
	section: Section,
	enforceRequired: boolean,
	onlyProvided: boolean,
	errors: ValidationErrors
): PropertyValues {
	const values: PropertyValues = {};
	for (const property of properties) {
		if (property.type === 'generated') {
			continue;
		}

		const raw = input[property.property_name];
		if (onlyProvided && raw === undefined) {
			continue;
		}

		const value = Array.isArray(raw) ? raw.join(' ') : (raw ?? '');
		const error = validateValue(property, value, enforceRequired && property.required);
		if (error) {
			errors[`${section}.${property.property_name}`] = error;
		}

		const formatted = formatValue(property, value);
		if (formatted) {
			values[property.property_name] = formatted;
		}
	}
	return values;
}

function generate(
	properties: ContactProperty[],
	section: Section,
	values: PropertyValues,
	scope: { place: PropertyValues; contact: PropertyValues; lineage: Lineage },
	errors: ValidationErrors
) {
	for (const property of properties.filter((p) => p.type === 'generated')) {
		const problem = templateProblem(property.parameter);
		if (problem) {
			throw new Error(`generated property "${property.property_name}" ${problem}`);
		}

		const rendered = renderTemplate(property.parameter as string, scope).trim();
		if (!rendered && property.required) {
			errors[`${section}.${property.property_name}`] = 'Is Required';
		}
		if (rendered) {
			values[property.property_name] = rendered;
			scope[section][property.property_name] = rendered;
		}
	}
}

function stringValues(doc: Record<string, unknown> | undefined, properties: ContactProperty[]): PropertyValues {
	const values: PropertyValues = {};
	for (const property of properties) {
		const value = doc?.[property.property_name];
		if (value !== undefined && value !== null && typeof value !== 'object') {
			values[property.property_name] = String(value);
		}
	}
	return values;
}
