import { expect } from 'chai';

import { ContactType } from '../../src/lib/config';
import { person, place } from '../../src/services/models';
import { Validation } from '../../src/lib/validation';

type Scenario = {
  type: string;
  prop: string;
  isValid: boolean;
  validator?: string | string[];
  formatted?: string;
};

const scenarios: Scenario[] = [
  { type: 'string', prop: 'abc', isValid: true },
  { type: 'string', prop: ' ab\nc', isValid: true, formatted: 'abc' },
  { type: 'string', prop: 'Mr.  Sand(m-a-n)', isValid: true, formatted: 'Mr Sand(m-a-n)' },
  { type: 'string', prop: '', isValid: false, formatted: '' },

  { type: 'phone', prop: '+254712345678', isValid: true, formatted: '0712 345678', validator: 'KE' },
  { type: 'phone', prop: '712345678', isValid: true, formatted: '0712 345678', validator: 'KE' },
  { type: 'phone', prop: '+254712345678', isValid: false, formatted: '0712 345678', validator: 'UG' },
  { type: 'phone', prop: '+17058772274', isValid: false, formatted: '(705) 877-2274', validator: 'KE' },

  { type: 'string', validator: '^\\d{6}$', prop: '123456', isValid: true },
  { type: 'string', validator: '^\\d{6}$', prop: ' 123456 *&%', isValid: true, formatted: '123456' },
  { type: 'string', validator: '^\\d{6}$', prop: '1234567', isValid: false },

  { type: 'name', prop: 'abc', isValid: true, formatted: 'Abc' },
  { type: 'name', prop: 'a b c', isValid: true, formatted: 'A B C' },
  { type: 'name', prop: 'WELDON KO(E)CH \n', isValid: true, formatted: 'Weldon Ko(e)ch' },
  { type: 'name', prop: 'Orie-rogo', isValid: true, formatted: 'Orie-Rogo' },
  { type: 'name', prop: "S 'am 's", isValid: true, formatted: "S'am's" },
  { type: 'name', prop: 'Sam\'s CHU', validator: ['CHU', 'Comm Unit'], isValid: true, formatted: 'Sam\'s' },

  { type: 'gender', prop: 'Man', isValid: true, formatted: 'Male' },
  { type: 'gender', prop: 'male', isValid: true, formatted: 'Male' },
  { type: 'gender', prop: 'F', isValid: true, formatted: 'Female' },
  { type: 'gender', prop: 'Female', isValid: true, formatted: 'Female' },
  { type: 'gender', prop: 'Woman', isValid: true, formatted: 'Female' },
  { type: 'gender', prop: 'X', isValid: false },
];

describe('lib/validation', () => {
  for (const scenario of scenarios) {
    it(`scenario: ${JSON.stringify(scenario)}`, () => {
      const contactType = mockContactType(scenario.type, scenario.validator);
      const place = mockPlace(scenario.prop);
      const contact = mockContact();
  
      const actualValidity = Validation.getInvalidProperties(contactType, place, contact);
      expect(actualValidity).to.deep.eq(scenario.isValid ? [] : ['csv']);

      const actualFormatted = Validation.format(contactType, place, contact);
      expect(actualFormatted.place.properties.prop).to.eq(scenario.formatted || scenario.prop);
    }); 
  }

  it('unknown property type throws', () => {
    const contactType = mockContactType('unknown`', undefined);
    const place = mockPlace('prop');
    const contact = mockContact();
  
    expect(() => Validation.getInvalidProperties(contactType, place, contact)).to.throw('unvalidatable');
  });

  it('property with required:false can be empty', () => {
    const contactType = mockContactType('string', undefined);
    contactType.place_properties[0].required = false;

    const place = mockPlace(undefined);
    place.properties = {};

    const contact = mockContact();
    expect(Validation.getInvalidProperties(contactType, place, contact)).to.be.empty;
  });
});

const mockPlace = (prop: any) : place => ({
  id: 'id',
  type: 'place',
  contact: 'contact',
  properties: { prop },
  workbookId: 'work',
});

const mockContact = () : person => ({
  id: 'pid',
  properties: {}
});

const mockContactType = (propertyType = 'string', propertyValidator: string | string[] | undefined) : ContactType => ({
  name: 'foo',
  friendly: 'bar',
  parent_type: 'parent',
  contact_type: 'contact',
  contact_role: 'role',
  place_properties: [mockProperty(propertyType, propertyValidator)],
  contact_properties: [],
});

const mockProperty = (type = 'string', validator: string | string[] | undefined) => ({
  csv_name: 'csv',
  doc_name: 'prop',
  type,
  validator,
  required: true
});
