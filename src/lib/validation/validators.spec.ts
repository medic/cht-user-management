import { describe, expect, it } from 'vitest';

import type { ContactProperty } from '../config-types';
import { renderTemplate, templateProblem } from './index';
import { formatValue, validateValue } from './validators';

const property = (overrides: Partial<ContactProperty>): ContactProperty => ({
	friendly_name: 'Field',
	property_name: 'field',
	type: 'string',
	required: true,
	...overrides
});

describe('ported validators', () => {
	it('formats names like legacy: strips configured suffixes and title-cases', () => {
		const name = property({ type: 'name', parameter: ['\\sCommunity Health Unit'] });
		expect(formatValue(name, 'kanyakwar  community health unit')).toBe('Kanyakwar');
		expect(formatValue(name, "o'brien (chv) iii")).toBe("O'brien (Chv) III");
	});

	it('validates and formats phones for the configured region', () => {
		const phone = property({ type: 'phone', parameter: 'KE' });
		expect(validateValue(phone, '0712345678', true)).toBeUndefined();
		expect(formatValue(phone, '0712345678')).toBe('+254712345678');
		expect(validateValue(phone, '123', true)).toBe('Not a valid KE phone number');
	});

	it('uses errorDescription for a failed regex', () => {
		const regex = property({ type: 'regex', parameter: '^\\d{6}$', errorDescription: 'Expects six digits' });
		expect(validateValue(regex, '12', true)).toBe('Expects six digits');
		expect(validateValue(regex, '123456', true)).toBeUndefined();
	});

	it('only requires a value when the property is required', () => {
		expect(validateValue(property({}), '', true)).toBe('Is Required');
		expect(validateValue(property({}), '', false)).toBeUndefined();
	});

	it('checks select options', () => {
		const select = property({ type: 'select_multiple', parameter: { a: 'A', b: 'B' } });
		expect(validateValue(select, 'a b', true)).toBeUndefined();
		expect(validateValue(select, 'a c', true)).toBe('Invalid values for property "Field": c');
	});

	it('accepts ages and slash dates as dates of birth', () => {
		const dob = property({ type: 'dob' });
		expect(formatValue(dob, '26/2/1985')).toBe('1985-02-26');
		expect(validateValue(dob, '38', true)).toBeUndefined();
		expect(validateValue(dob, '2999-01-01', true)).toMatch(/Not a valid Date of Birth/);
	});
});

describe('generated templates', () => {
	const scope = { place: { village: 'Kiboga' }, contact: { first_name: 'Jane', last_name: 'Doe' }, lineage: { followup_area: 'Zone 4' } };

	it('replace each placeholder with its value, or nothing', () => {
		expect(renderTemplate('{{ contact.last_name }} {{ contact.first_name }} ({{ lineage.followup_area }})', scope)).toBe('Doe Jane (Zone 4)');
		expect(renderTemplate('{{place.village}}|{{  contact.first_name  }}|{{ contact.missing }}', scope)).toBe('Kiboga|Jane|');
		// built-in properties aren't values, and a value is never read as a template
		expect(renderTemplate('{{ contact.constructor }}', scope)).toBe('');
		expect(renderTemplate('{{ contact.name }}', { ...scope, contact: { name: '{{ place.village }}' } })).toBe('{{ place.village }}');
	});

	it('are refused when they use anything but placeholders', () => {
		expect(templateProblem('{{ contact.name }} Area')).toBeUndefined();
		for (const template of ['{{ contact.name | upcase }}', '{% if contact.name %}x{% endif %}', '{{ name }}', '{{ contact.name }']) {
			expect(templateProblem(template), template).toMatch(/can only use/);
		}
		expect(templateProblem(42)).toMatch(/string template/);
	});
});
