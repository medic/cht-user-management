import { expect } from 'chai';

import { Validation } from '../../src/lib/validation';
import { mockSimpleContactType, mockPlace } from '../mocks';

type Scenario = {
  type: string;
  prop: string;
  isValid: boolean;
  validator?: string | string[];
  altered?: string;
};

const scenarios: Scenario[] = [
  { type: 'string', prop: 'abc', isValid: true },
  { type: 'string', prop: ' ab\nc', isValid: true, altered: 'abc' },
  { type: 'string', prop: 'Mr.  Sand(m-a-n)', isValid: true, altered: 'Mr Sand(m-a-n)' },
  { type: 'string', prop: '', isValid: false, altered: '' },

  { type: 'phone', prop: '+254712345678', isValid: true, altered: '0712 345678', validator: 'KE' },
  { type: 'phone', prop: '712345678', isValid: true, altered: '0712 345678', validator: 'KE' },
  { type: 'phone', prop: '+254712345678', isValid: false, altered: '0712 345678', validator: 'UG' },
  { type: 'phone', prop: '+17058772274', isValid: false, altered: '(705) 877-2274', validator: 'KE' },

  { type: 'regex', validator: '^\\d{6}$', prop: '123456', isValid: true },
  { type: 'regex', validator: '^\\d{6}$', prop: ' 123456 *&%', isValid: true, altered: '123456' },
  { type: 'regex', validator: '^\\d{6}$', prop: '1234567', isValid: false },
  { type: 'regex', validator: undefined, prop: 'abc', isValid: false },

  { type: 'name', prop: 'abc', isValid: true, altered: 'Abc' },
  { type: 'name', prop: 'a b c', isValid: true, altered: 'A B C' },
  { type: 'name', prop: 'WELDON KO(E)CH \n', isValid: true, altered: 'Weldon Ko(e)ch' },
  { type: 'name', prop: "S 'am 's", isValid: true, altered: "S'am's" },
  { type: 'name', prop: 'Sam\'s CHU', validator: ['CHU', 'Comm Unit'], isValid: true, altered: 'Sam\'s' },

  { type: 'gender', prop: 'Man', isValid: true, altered: 'Male' },
  { type: 'gender', prop: 'male', isValid: true, altered: 'Male' },
  { type: 'gender', prop: 'F', isValid: true, altered: 'Female' },
  { type: 'gender', prop: 'Female', isValid: true, altered: 'Female' },
  { type: 'gender', prop: 'Woman', isValid: true, altered: 'Female' },
  { type: 'gender', prop: 'X', isValid: false },
];

describe('lib/validation', () => {
  for (const scenario of scenarios) {
    it(`scenario: ${JSON.stringify(scenario)}`, () => {
      const contactType = mockSimpleContactType(scenario.type, scenario.validator);
      const place = mockPlace(contactType, scenario.prop);
  
      const actualValidity = Validation.getInvalidProperties(place);
      expect(actualValidity).to.deep.eq(scenario.isValid ? [] : ['place_prop']);

      const actualAltered = Validation.format(place);
      expect(actualAltered.properties.prop).to.eq(scenario.altered || scenario.prop);
    }); 
  }

  it('unknown property type throws', () => {
    const contactType = mockSimpleContactType('unknown`', undefined);
    const place = mockPlace(contactType, 'prop');
  
    expect(() => Validation.getInvalidProperties(place)).to.throw('unvalidatable');
  });

  it('property with required:false can be empty', () => {
    const contactType = mockSimpleContactType('string', undefined);
    contactType.place_properties[1].required = false;

    const place = mockPlace(contactType, undefined);
    place.properties = { name: 'foo' };

    expect(Validation.getInvalidProperties(place)).to.be.empty;
  });

  it('parent is invalid when missing but expected', () => {
    const contactType = mockSimpleContactType('string', undefined);
    const place = mockPlace(contactType, 'prop');
    delete place.parentDetails;

    expect(Validation.getInvalidProperties(place)).to.deep.eq(['place_PARENT']);
  });

  it('parent is valid when missing and not expected', () => {
    const contactType = mockSimpleContactType('string', undefined);
    delete contactType.parent_type;
    
    const place = mockPlace(contactType, 'prop');
    delete place.parentDetails;

    expect(Validation.getInvalidProperties(place)).to.be.empty;
  });

  it('replacement property is validated and altered as doc_name:name', () => {
    const contactType = mockSimpleContactType('string', undefined);
    
    const place = mockPlace(contactType, 'foo');
    place.properties.replacement = 'sin bad';

    Validation.format(place);
    expect(place.replacementName).to.eq('Sin Bad');

    const invalidProperties = Validation.getInvalidProperties(place);
    expect(invalidProperties).to.deep.eq(['place_replacement']);
  });
});

