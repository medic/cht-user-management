import { expect } from 'chai';
import { PropertyValues, UnvalidatedPropertyValue } from '../src/property-value';
import { ContactProperty } from '../src/config';
import { mockProperty } from './mocks';

describe('property-value', () => {
  const namePropertyValue: ContactProperty = mockProperty('name');
  const includeScenarios = [
    { searchWithin: 'abc', searchFor: 'bc', expected: true },
    { searchWithin: 'abc', searchFor: 'AbC', expected: true },
    { searchWithin: 'place', searchFor: '', expected: true },
    { searchWithin: 'plÀce', searchFor: 'lac', expected: true },
    { searchWithin: 'place', searchFor: 'À', expected: true },
    { searchWithin: 'plÀce', searchFor: 'lAc', expected: true },

    { searchWithin: 'abc', searchFor: 'e', expected: false },
    { searchWithin: 'abc', searchFor: undefined, expected: false },
    { searchWithin: 'abc', searchFor: ' a', expected: false },
    { searchWithin: undefined, searchFor: 'a', expected: false },
    { searchWithin: undefined, searchFor: undefined, expected: false },

    { searchWithin: new UnvalidatedPropertyValue('abc'), searchFor: 'a', expected: true },
    { searchWithin: new UnvalidatedPropertyValue('abc'), searchFor: 'a', expected: true },

    { searchWithin: new RemotePlacePropertyValue('a.b.c', namePropertyValue), searchFor: 'a b c', expected: true },
    {
      searchWithin: new RemotePlacePropertyValue('a.b.c', namePropertyValue),
      searchFor: new RemotePlacePropertyValue('a.b c', namePropertyValue),
      expected: true
    },
  ];

  const generatedScenario = (formattedValue: string) => {
    const result = new UnvalidatedPropertyValue(formattedValue);
    result.original = '';
    return result;
  };

  const matchScenarios = [
    { a: 'abc', b: 'abc', expected: true },
    { a: 'abc', b: 'AbC', expected: true },
    { a: 'plÀce', b: 'PlacE', expected: true },
    { a: 'place', b: 'PlÀcE', expected: true },

    { a: 'place', b: 'lÀc', expected: false },
    { a: undefined, b: 'abc', expected: false },
    { a: 'abc', b: undefined, expected: false },
    { a: undefined, b: undefined, expected: false },

    {
      a: generatedScenario('iji'),
      b: generatedScenario('iJI'),
      expected: true
    },
    {
      a: generatedScenario('abc'),
      b: generatedScenario('efg'),
      expected: false
    },
  ];

  describe('include', () => {
    for (const scenario of includeScenarios) {
      it(JSON.stringify(scenario), () => {
        const actual = PropertyValues.includes(scenario.searchWithin, scenario.searchFor);
        expect(actual).to.eq(scenario.expected);
      });
    }
  });

  describe('isMatch', () => {
    for (const scenario of matchScenarios) {
      it(JSON.stringify(scenario), () => {
        const actual = PropertyValues.isMatch(scenario.a, scenario.b);
        expect(actual).to.eq(scenario.expected);
      });
    }
  });
});
