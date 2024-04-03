import { ChtApi } from '../../src/lib/cht-api';
import { expect } from 'chai';
import { mockChtSession } from '../mocks';

const scenarios = [
  { version: '4.2.2', expected: 'base' },
  { version: '4.2.2.6922454971', expected: 'base' },
  { version: '4.8.1', expected: '4.7' },
  { version: '5.0', expected: '4.7' },
  { version: '4.6.0-local-development', expected: '4.7' },
  { version: '4.6.0', expected: '4.6' },
  { version: '4.6.0-feature-release', expected: '4.6' },
  { version: '4.6.0-dev.1682192676689', expected: '4.6' },
];

describe('lib/cht-api.ts', () => {
  beforeEach(() => {});

  describe('create', () => {
    for (const scenario of scenarios) {
      it(JSON.stringify(scenario), () => {
        const session = mockChtSession();
        session.chtCoreVersion = scenario.version;
        const chtApi = ChtApi.create(session);
        expect(chtApi.coreVersion).to.eq(scenario.expected);
      });
    }

    it('crash due to whatever', () => {
      const session = mockChtSession();
      session.chtCoreVersion = 'invalid';
      expect(() => ChtApi.create(session)).to.throw('invalid');
    });
  });
});

