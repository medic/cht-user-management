import { DateTime } from 'luxon';
import { expect } from 'chai';

import { mockPlace, mockSimpleContactType, mockSupersetContactType } from './mocks';
import RemotePlaceResolver from '../src/lib/remote-place-resolver';
import { UnvalidatedPropertyValue } from '../src/property-value';

type Scenario = {
  type: string;
  prop?: string;
  isValid: boolean;
  propertyParameter?: string | string[] | object;
  formatted?: string;
  propertyErrorDescription?: string;
  error?: string;
};

const EMAIL_REGEX = '^[a-zA-Z0-9._+-]+@[a-zA-Z0-9.-]+.[a-zA-Z]{2,}$';
const GENDER_OPTIONS = { male: 'Male', female: 'Female' };
const CANDIES_OPTIONS = { chocolate: 'Chocolate', strawberry: 'Strawberry' };

const scenarios: Scenario[] = [
  { type: 'string', prop: undefined, isValid: false, error: 'Required', formatted: '' },
  { type: 'string', prop: 'abc', isValid: true },
  { type: 'string', prop: ' ab\nc', isValid: true, formatted: 'abc' },
  { type: 'string', prop: 'Mr.  Sand(m-a-n)', isValid: true, formatted: 'Mr. Sand(m-a-n)' },
  { type: 'string', prop: 'Université ', isValid: true, formatted: 'Université' },
  { type: 'string', prop: `Infirmière d'Etat`, isValid: true, formatted: `Infirmière d'Etat` },
  { type: 'string', prop: '', isValid: false, formatted: '', error: 'Required' },
  
  { type: 'phone', prop: undefined, isValid: false, error: 'Required', formatted: '' },
  { type: 'phone', prop: '+254712345678', isValid: true, formatted: '0712 345678', propertyParameter: 'KE' },
  { type: 'phone', prop: '712345678', isValid: true, formatted: '0712 345678', propertyParameter: 'KE' },
  { type: 'phone', prop: '+254712345678', isValid: false, formatted: '0712 345678', propertyParameter: 'UG', error: 'Not a valid' },
  { type: 'phone', prop: '+17058772274', isValid: false, formatted: '(705) 877-2274', propertyParameter: 'KE', error: 'KE' },
  
  { type: 'regex', prop: undefined, isValid: false, error: 'Required', formatted: '' },
  { type: 'regex', propertyParameter: '^\\d{6}$', prop: '123456', isValid: true },
  { type: 'regex', propertyParameter: '^\\d{6}$', prop: ' 123456 *&%', isValid: true, formatted: '123456' },
  { type: 'regex', propertyParameter: '^\\d{6}$', prop: '1234567', isValid: false, error: 'six digit', propertyErrorDescription: 'six digit number' },
  { type: 'regex', propertyParameter: EMAIL_REGEX, prop: 'email@address.com', isValid: true, formatted: 'email@address.com' },
  { type: 'regex', propertyParameter: EMAIL_REGEX, prop: '.com', isValid: false, propertyErrorDescription: 'valid email address', error: 'email' },
  { type: 'regex', propertyParameter: undefined, prop: 'abc', isValid: false, error: 'missing parameter' },
  
  { type: 'name', prop: undefined, isValid: false, error: 'Required', formatted: '' },
  { type: 'name', prop: 'abc', isValid: true, formatted: 'Abc' },
  { type: 'name', prop: 'a b c', isValid: true, formatted: 'A B C' },
  { type: 'name', prop: 'Mr.  Sand(m-a-n)', isValid: true, formatted: 'Mr Sand(M-A-N)' },
  { type: 'name', prop: 'WELDON KO(E)CH \n', isValid: true, formatted: 'Weldon Ko(E)ch' },
  { type: 'name', prop: 'S \'am \'s', isValid: true, formatted: 'S\'am\'s' },
  { type: 'name', prop: 'this-is-(a-place)', isValid: true, formatted: 'This-Is-(A-Place)' },
  { type: 'name', prop: 'mr.    chp-(per-son)', isValid: true, formatted: 'Mr Chp-(Per-Son)' },
  { type: 'name', prop: 'ma-#ma-(pa-pa)', isValid: true, formatted: 'Ma-Ma-(Pa-Pa)' },
  { type: 'name', prop: 'KYAMBOO/KALILUNI', isValid: true, formatted: 'Kyamboo / Kaliluni' },
  { type: 'name', prop: 'NZATANI / ILALAMBYU', isValid: true, formatted: 'Nzatani / Ilalambyu' },
  { type: 'name', prop: 'Sam\'s CHU', propertyParameter: ['CHU', 'Comm Unit'], isValid: true, formatted: 'Sam\'s' },
  { type: 'name', prop: 'Jonathan M.Barasa', isValid: true, formatted: 'Jonathan M Barasa' },
  { type: 'name', prop: 'Robert xiv', isValid: true, formatted: 'Robert XIV' },
  { type: 'name', prop: ' ', isValid: true, formatted: '' },

  { type: 'dob', prop: undefined, isValid: false, error: 'Required', formatted: '' },
  { type: 'dob', prop: '', isValid: false },
  { type: 'dob', prop: '2016/05/25', isValid: false },
  { type: 'dob', prop: 'May 25, 2016', isValid: false },
  { type: 'dob', prop: '2030-05-25', isValid: false },
  { type: 'dob', prop: '2016-05-25', isValid: true, formatted: '2016-05-25' },
  { type: 'dob', prop: ' 20 16- 05- 25 ', isValid: true, formatted: '2016-05-25' },
  { type: 'dob', prop: '20', isValid: true, formatted: DateTime.now().minus({ years: 20 }).toISODate() },
  { type: 'dob', prop: ' 20 ', isValid: true, formatted: DateTime.now().minus({ years: 20 }).toISODate() },
  { type: 'dob', prop: 'abc', isValid: false, formatted: 'abc' },
  { type: 'dob', prop: '  1 0   0 ', isValid: true, formatted: DateTime.now().minus({ years: 100 }).toISODate() },
  { type: 'dob', prop: '-1', isValid: false, formatted: '-1' },
  { type: 'dob', prop: '15/2/1985', isValid: true, formatted: '1985-02-15' },
  { type: 'dob', prop: '1/2/1 985', isValid: true, formatted: '1985-02-01' },
  { type: 'dob', prop: '1/13/1985', isValid: false },
  
  { type: 'select_one', prop: undefined, isValid: false, error: 'Required', formatted: '' },
  { type: 'select_one', prop: ' male', isValid: true, propertyParameter: GENDER_OPTIONS },
  { type: 'select_one', prop: 'female ', isValid: true, propertyParameter: GENDER_OPTIONS },
  { type: 'select_one', prop: 'FeMale ', isValid: false, propertyParameter: GENDER_OPTIONS },
  { type: 'select_one', prop: 'f', isValid: false, propertyParameter: GENDER_OPTIONS },
  { type: 'select_one', prop: '', isValid: false, propertyParameter: GENDER_OPTIONS },

  { type: 'select_multiple', prop: undefined, isValid: false, error: 'Required', formatted: '' },
  { type: 'select_multiple', prop: 'chocolate', isValid: true, propertyParameter: CANDIES_OPTIONS },
  { type: 'select_multiple', prop: 'chocolate strawberry', isValid: true, propertyParameter: CANDIES_OPTIONS },
  { type: 'select_multiple', prop: ' chocolate  strawberry', isValid: true, propertyParameter: CANDIES_OPTIONS },
  { type: 'select_multiple', prop: 'c,s', isValid: false, propertyParameter: CANDIES_OPTIONS, error: 'Invalid values' },
  { type: 'select_multiple', prop: '', isValid: false, propertyParameter: CANDIES_OPTIONS, error: 'Required' },
  
  { type: 'generated', prop: 'b', propertyParameter: 'a {{ place.prop }} c', isValid: true, formatted: 'a b c' },
  { type: 'generated', prop: 'b', propertyParameter: '{{ contact.name }} ({{ lineage.PARENT }})', isValid: true, formatted: 'Contact (Parent)' },
  { type: 'generated', prop: 'b', propertyParameter: 'x {{ contact.dne }}', isValid: true, formatted: 'x ' },
];

describe('validation', () => {
  for (const scenario of scenarios) {
    it(`scenario: ${JSON.stringify(scenario)}`, () => {
      const contactType = mockSimpleContactType(scenario.type, scenario.propertyParameter, scenario.propertyErrorDescription);
      contactType.contact_properties = [contactType.place_properties[0]];
      const place = mockPlace(contactType, { place_prop: scenario.prop });

      const actualValidity = Object.keys(place.validationErrors || {});
      expect(actualValidity).to.deep.eq(scenario.isValid ? [] : ['place_prop']);

      if (scenario.error) {
        const firstError = Object.values(place.validationErrors || {})[0];
        expect(firstError).to.include(scenario.error);
      }

      expect(place.properties.prop.formatted).to.eq(scenario.formatted ?? scenario.prop);
    });
  }

  it('unknown property type throws', () => {
    const contactType = mockSimpleContactType('unknown`', undefined);
    expect(() => mockPlace(contactType)).to.throw('unvalidatable');
  });

  it('property with required:false can be empty', () => {
    const contactType = mockSimpleContactType('string', undefined);
    contactType.place_properties[contactType.place_properties.length-1].required = false;

    const place = mockPlace(contactType);
    place.properties = { name: new UnvalidatedPropertyValue('name') };
    place.hierarchyProperties = { PARENT: new UnvalidatedPropertyValue('parent', 'PARENT') };

    place.validate();
    expect(place.validationErrors).to.be.empty;
  });

  it('#91 - parent is invalid when required:false but resolution is NoResult', () => {
    const contactType = mockSimpleContactType('string', undefined);
    contactType.hierarchy[0].required = false;

    const place = mockPlace(contactType);
    place.resolvedHierarchy[1] = RemotePlaceResolver.NoResult;

    place.validate();
    expect(place.validationErrors).to.deep.eq({
      hierarchy_PARENT: `Cannot find 'parent' matching 'parent'`
    });
  });

  it('parent is invalid when missing but expected', () => {
    const contactType = mockSimpleContactType('string', undefined);
    const place = mockPlace(contactType);
    delete place.resolvedHierarchy[1];

    place.validate();
    expect(place.validationErrors).to.deep.eq({
      hierarchy_PARENT: `Cannot find 'parent' matching 'parent'`,
    });
  });

  it('parent is valid when missing and not expected', () => {
    const contactType = mockSimpleContactType('string', undefined);
    contactType.hierarchy[0].required = false;

    const place = mockPlace(contactType);
    delete place.resolvedHierarchy[1];

    place.validate();
    expect(place.validationErrors).to.be.empty;
  });

  it('replacement property is validated and formatted as property_name:name', () => {
    const contactType = mockSimpleContactType('string', undefined);

    const place = mockPlace(contactType, { hierarchy_replacement: 'sin bad' });
    expect(place.hierarchyProperties.replacement.formatted).to.eq('Sin Bad');

    place.validate();
    expect(place.validationErrors).to.deep.eq({
      hierarchy_replacement: `Cannot find 'contacttype-name' matching 'sin bad' under 'parent'`,
    });
  });

  it('user_role property empty throws', () => {
    const contactType = mockSimpleContactType('string', undefined);
    contactType.user_role = [];

    expect(() => mockPlace(contactType)).to.throw('unvalidatable');
  });

  it('user_role property contains empty string throws', () => {
    const contactType = mockSimpleContactType('string', undefined);
    contactType.user_role = [''];

    expect(() => mockPlace(contactType)).to.throw('unvalidatable');
  });

  it('user role is invalid when not allowed', () => {
    const contactType = mockSimpleContactType('string', undefined);
    contactType.user_role = ['supervisor', 'stock_manager'];

    const place = mockPlace(contactType, {
      place_prop: 'abc',
      contact_prop: 'efg',
      garbage: 'ghj',
      user_role: 'supervisor stockmanager',
    });
    
    place.validate();
    expect(place.validationErrors).to.deep.eq({
      user_role: `Invalid values for property "Roles": stockmanager`
    });
  });

  it('superset mode invalid throws', () => {
    const contactType = mockSupersetContactType();

    const place = mockPlace(contactType, {
      place_prop: 'abc',
      contact_name: 'efg',
      contact_email: 'test@example.com',
      superset_mode: 'enabled',
    });
    
    place.validate();
    expect(place.validationErrors).to.deep.eq({
      superset_mode: 'Is Invalid allowed values: enable, disable'
    });
  });
});
