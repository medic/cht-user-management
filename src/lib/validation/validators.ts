// Ported from src/validation/validator-*.ts. `generated` is handled in ./index.ts because it renders
// from the other property values rather than validating an input.
import { DateTime } from 'luxon';
import { isValidNumberForRegion, parsePhoneNumber, type CountryCode } from 'libphonenumber-js';

import type { ContactProperty, PropertyType } from '../config-types';

export interface Validator {
	isValid(input: string, property: ContactProperty): boolean | string;
	format(input: string, property: ContactProperty): string;
	readonly defaultError: string;
}

const string: Validator = {
	isValid: (input) => !!input,
	format: (input) =>
		input
			.replace(/[^^\p{L}\p{N}\p{M} ()@./\-_']/gu, '')
			.replace(/\s\s+/g, ' ')
			.trim(),
	defaultError: 'Is Required'
};

function titleCase(value: string): string {
	if (!value) {
		return '';
	}

	const capitalise = (word: string) => (word[0]?.toUpperCase() ?? '') + word.slice(1);
	const isRomanNumeral = /^[ivx]+$/i;
	const splitAndProcess = (word: string, delimiter: string) =>
		word
			.split(delimiter)
			.map((part) => (part.match(isRomanNumeral) ? part.toUpperCase() : capitalise(part)))
			.join(delimiter);

	return value
		.toLowerCase()
		.replace(/\//g, ' / ')
		.replace(/\s+'/g, "'")
		.replace(/\(([^)]+)\)/g, (match) => `(${capitalise(match.slice(1, -1))})`)
		.split(' ')
		.filter(Boolean)
		.map((word) => splitAndProcess(word, '-'))
		.join(' ')
		.replace(/\s+/g, ' ')
		.trim();
}

const name: Validator = {
	isValid: (input, property) => {
		if (property.parameter && !Array.isArray(property.parameter)) {
			throw new Error(`Property '${property.friendly_name}' of type 'name' expects 'parameter' to be an array.`);
		}
		return !!input;
	},
	format: (input, property) => {
		let toFormat = input.replace(/\./g, ' ').replace(/\//g, ' / ').replace(/\s+/g, ' ');
		if (property.parameter) {
			if (!Array.isArray(property.parameter)) {
				throw new Error('property with type "name": parameter should be an array');
			}
			toFormat = property.parameter.reduce((agg, toRemove) => agg.replace(new RegExp(toRemove, 'ig'), ''), toFormat);
		}
		return titleCase(string.format(toFormat, property));
	},
	defaultError: 'Is Required'
};

const phone: Validator = {
	isValid: (input, property) => {
		if (typeof property.parameter !== 'string') {
			throw new Error(`property '${property.friendly_name}' of type 'phone' expects 'parameter' to be a string.`);
		}
		try {
			return isValidNumberForRegion(input, property.parameter as CountryCode) || `Not a valid ${property.parameter} phone number`;
		} catch (e) {
			return String(e);
		}
	},
	format: (input, property) => {
		try {
			return parsePhoneNumber(input, property.parameter as CountryCode).format('E.164');
		} catch {
			return input;
		}
	},
	defaultError: 'Not a valid regional phone number'
};

const parseDob = (input: string): DateTime => {
	const stripped = input.replace(/\s/gi, '');
	const asNumber = Number(stripped);
	if (!isNaN(asNumber) && asNumber > 0) {
		return DateTime.now().minus({ years: asNumber });
	}
	return stripped.includes('/') ? DateTime.fromFormat(stripped, 'd/M/yyyy') : DateTime.fromISO(stripped);
};

const dob: Validator = {
	isValid: (input) => {
		try {
			const parsed = parseDob(input);
			return parsed.isValid && parsed < DateTime.now();
		} catch {
			return false;
		}
	},
	format: (input) => {
		if (!dob.isValid(input, {} as ContactProperty)) {
			return input;
		}
		return parseDob(input).toISODate() ?? input;
	},
	defaultError: 'Not a valid Date of Birth (eg. 1990-02-26 or 26/2/1985 or 38)'
};

const regex: Validator = {
	isValid: (input, property) => {
		if (typeof property.parameter !== 'string') {
			throw new Error(`property '${property.friendly_name}' of type 'regex' expects 'parameter' to be a string.`);
		}
		return !!string.format(input, property).match(new RegExp(property.parameter));
	},
	format: (input, property) => string.format(input, property),
	defaultError: 'Value is invalid'
};

const assertOptions = (property: ContactProperty): Record<string, string> => {
	if (!property.parameter || typeof property.parameter !== 'object' || Array.isArray(property.parameter)) {
		throw new TypeError(`Expected attribute "parameter" on property ${property.property_name} to be an object.`);
	}
	return property.parameter;
};

const selectOne: Validator = {
	isValid: (input, property) => {
		const trimmed = string.format(input, property);
		if (!trimmed && property.required) {
			return 'Value is required';
		}
		return Object.keys(assertOptions(property)).includes(trimmed);
	},
	format: (input) => input,
	defaultError: 'Invalid value selected'
};

const selectMultiple: Validator = {
	isValid: (input, property) => {
		const options = Object.keys(assertOptions(property));
		const selected = input
			.split(' ')
			.map((value) => string.format(value, property))
			.filter(Boolean);
		const invalid = selected.filter((value) => !options.includes(value));
		if (invalid.length) {
			return `Invalid values for property "${property.friendly_name}": ${invalid.join(', ')}`;
		}
		if (!selected.length && property.required) {
			return 'Value is required';
		}
		return true;
	},
	format: (input) => input,
	defaultError: "Invalid input. Please use 'space' as delimiter."
};

const none: Validator = {
	isValid: () => true,
	format: (input) => input,
	defaultError: 'Value is invalid'
};

const VALIDATORS: Record<Exclude<PropertyType, 'generated'>, Validator> = {
	dob,
	name,
	none,
	phone,
	regex,
	string,
	select_one: selectOne,
	select_multiple: selectMultiple
};

export function validatorFor(type: PropertyType): Validator {
	if (type === 'generated') {
		throw new Error('generated properties have no input validator');
	}
	const validator = VALIDATORS[type];
	if (!validator) {
		throw new Error(`unvalidatable property type "${type}"`);
	}
	return validator;
}

export function formatValue(property: ContactProperty, value: string): string {
	return value ? validatorFor(property.type).format(value, property) : value;
}

// Mirrors legacy Validation.validateProperty: returns an error message, or undefined when valid
export function validateValue(property: ContactProperty, value: string, required: boolean): string | undefined {
	if (!value && required) {
		return 'Is Required';
	}
	if (!value) {
		return undefined;
	}

	const validator = validatorFor(property.type);
	try {
		const result = validator.isValid(value, property);
		if (result === true) {
			return undefined;
		}
		return typeof result === 'string' ? result : property.errorDescription || validator.defaultError;
	} catch (e) {
		return `Error in isValid for '${property.type}': ${e}`;
	}
}
