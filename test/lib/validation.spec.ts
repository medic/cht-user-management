import { expect } from 'chai';

import { Validation } from '../../src/lib/validation';
import { mockSimpleContactType, mockPlace } from '../mocks';

type Scenario = {
  type: string;
  prop: string;
  isValid: boolean;
  propertyParameter?: string | string[];
  altered?: string;
  propertyErrorDescription?: string;
  error?: string;
};

const EMAIL_REGEX = '^[a-zA-Z0-9._+-]+@[a-zA-Z0-9.-]+.[a-zA-Z]{2,}$';

const scenarios: Scenario[] = [
  { type: 'string', prop: 'abc', isValid: true },
  { type: 'string', prop: ' ab\nc', isValid: true, altered: 'abc' },
  { type: 'string', prop: 'Mr.  Sand(m-a-n)', isValid: true, altered: 'Mr. Sand(m-a-n)' },
  { type: 'string', prop: 'Université ', isValid: true, altered: 'Université' },
  { type: 'string', prop: `Infirmière d'Etat`, isValid: true, altered: `Infirmière d'Etat` },
  { type: 'string', prop: '', isValid: false, altered: '', error: 'Required' },
  
  { type: 'phone', prop: '+254712345678', isValid: true, altered: '0712 345678', propertyParameter: 'KE' },
  { type: 'phone', prop: '712345678', isValid: true, altered: '0712 345678', propertyParameter: 'KE' },
  { type: 'phone', prop: '+254712345678', isValid: false, altered: '0712 345678', propertyParameter: 'UG', error: 'Not a valid' },
  { type: 'phone', prop: '+17058772274', isValid: false, altered: '(705) 877-2274', propertyParameter: 'KE', error: 'KE' },
  
  { type: 'regex', propertyParameter: '^\\d{6}$', prop: '123456', isValid: true },
  { type: 'regex', propertyParameter: '^\\d{6}$', prop: ' 123456 *&%', isValid: true, altered: '123456' },
  { type: 'regex', propertyParameter: '^\\d{6}$', prop: '1234567', isValid: false, error: 'six digit', propertyErrorDescription: 'six digit number' },
  { type: 'regex', propertyParameter: EMAIL_REGEX, prop: 'email@address.com', isValid: true, altered: 'email@address.com' },
  { type: 'regex', propertyParameter: EMAIL_REGEX, prop: '.com', isValid: false, propertyErrorDescription: 'valid email address', error: 'email' },
  { type: 'regex', propertyParameter: undefined, prop: 'abc', isValid: false, error: 'missing parameter' },
  
  { type: 'name', prop: 'abc', isValid: true, altered: 'Abc' },
  { type: 'name', prop: 'a b c', isValid: true, altered: 'A B C' },
  { type: 'name', prop: 'Mr.  Sand(m-a-n)', isValid: true, altered: 'Mr Sand(m-a-n)' },
  { type: 'name', prop: 'WELDON KO(E)CH \n', isValid: true, altered: 'Weldon Ko(e)ch' },
  { type: 'name', prop: 'S \'am \'s', isValid: true, altered: 'S\'am\'s' },
  { type: 'name', prop: 'KYAMBOO/KALILUNI', isValid: true, altered: 'Kyamboo / Kaliluni' },
  { type: 'name', prop: 'NZATANI / ILALAMBYU', isValid: true, altered: 'Nzatani / Ilalambyu' },
  { type: 'name', prop: 'Sam\'s CHU', propertyParameter: ['CHU', 'Comm Unit'], isValid: true, altered: 'Sam\'s' },
  { type: 'name', prop: 'Jonathan M.Barasa', isValid: true, altered: 'Jonathan M Barasa' },

  { type: 'dob', prop: '', isValid: false },
  { type: 'dob', prop: '2016/05/25', isValid: false },
  { type: 'dob', prop: 'May 25, 2016', isValid: false },
  { type: 'dob', prop: '2030-05-25', isValid: false },
  { type: 'dob', prop: '2016-05-25', isValid: true, altered: '2016-05-25' },
  { type: 'dob', prop: ' 20 16- 05- 25 ', isValid: true, altered: '2016-05-25' },

  { type: 'gender', prop: 'Man', isValid: true, altered: 'male' },
  { type: 'gender', prop: 'male', isValid: true, altered: 'male' },
  { type: 'gender', prop: 'F', isValid: true, altered: 'female' },
  { type: 'gender', prop: 'Female', isValid: true, altered: 'female' },
  { type: 'gender', prop: 'Woman', isValid: true, altered: 'female' },
  { type: 'gender', prop: 'X', isValid: false, error: 'male' },
];

describe('lib/validation.ts', () => {
  for (const scenario of scenarios) {
    it(`scenario: ${JSON.stringify(scenario)}`, () => {
      const contactType = mockSimpleContactType(scenario.type, scenario.propertyParameter, scenario.propertyErrorDescription);
      const place = mockPlace(contactType, scenario.prop);

      const actualValidity = Validation.getValidationErrors(place);
      expect(actualValidity.map(a => a.property_name)).to.deep.eq(scenario.isValid ? [] : ['place_prop']);

      if (scenario.error) {
        expect(actualValidity?.[0].description).to.include(scenario.error);
      }

      const actualAltered = Validation.format(place);
      expect(actualAltered.properties.prop).to.eq(scenario.altered || scenario.prop);
    });
  }

  it('unknown property type throws', () => {
    const contactType = mockSimpleContactType('unknown`', undefined);
    const place = mockPlace(contactType, 'prop');

    expect(() => Validation.getValidationErrors(place)).to.throw('unvalidatable');
  });

  it('property with required:false can be empty', () => {
    const contactType = mockSimpleContactType('string', undefined);
    contactType.place_properties[contactType.place_properties.length-1].required = false;

    const place = mockPlace(contactType, undefined);
    place.properties = { name: 'foo' };
    place.hierarchyProperties = { PARENT: 'parent' };

    expect(Validation.getValidationErrors(place)).to.be.empty;
  });

  it('parent is invalid when missing but expected', () => {
    const contactType = mockSimpleContactType('string', undefined);
    const place = mockPlace(contactType, 'prop');
    delete place.resolvedHierarchy[1];

    expect(Validation.getValidationErrors(place)).to.deep.eq([{
      property_name: 'hierarchy_PARENT',
      description: `Cannot find 'parent' matching 'parent'`,
    }]);
  });

  it('parent is valid when missing and not expected', () => {
    const contactType = mockSimpleContactType('string', undefined);
    contactType.hierarchy[0].required = false;

    const place = mockPlace(contactType, 'prop');
    delete place.resolvedHierarchy[1];

    expect(Validation.getValidationErrors(place)).to.be.empty;
  });

  it('replacement property is validated and altered as property_name:name', () => {
    const contactType = mockSimpleContactType('string', undefined);

    const place = mockPlace(contactType, 'foo');
    place.hierarchyProperties.replacement = 'sin bad';

    Validation.format(place);
    expect(place.hierarchyProperties.replacement).to.eq('Sin Bad');

    const validationErrors = Validation.getValidationErrors(place);
    expect(validationErrors).to.deep.eq([{
      property_name: 'hierarchy_replacement',
      description: `Cannot find 'contacttype-name' matching 'Sin Bad' under 'Parent'`,
    }]);
  });
});

