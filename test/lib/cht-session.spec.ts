import Chai from 'chai';
import rewire from 'rewire';
import sinon from 'sinon';

import { AuthenticationInfo } from '../../src/config';
import { RemotePlace } from '../../src/lib/cht-api';
const ChtSession = rewire('../../src/lib/cht-session');

import chaiAsPromised from 'chai-as-promised';
Chai.use(chaiAsPromised);

const { expect } = Chai;

const mockAuthInfo: AuthenticationInfo = {
  friendly: 'friendly',
  domain: 'foo.com',
  useHttp: true,
};

const mockSessionResponse = (headers: Array<string> = ['AuthSession=123']) => ({
  headers: {
    get: sinon.stub().returns(headers),
  },
});

const mockUserFacilityDoc = (facilityId: string = 'parent-id', roles:string[] = []) => ({
  data: {
    roles,
    facility_id: facilityId,
  }
});

let mockAxios;

describe('lib/cht-session.ts', () => {
  beforeEach(() => {
    mockAxios = {
      interceptors: {
        request: {
          use: sinon.stub(),
        },
        response: {
          use: sinon.stub(),
        },
      },
      post: sinon.stub().resolves(mockSessionResponse()),
      get: sinon.stub().resolves(mockUserFacilityDoc()),
    };
    ChtSession.__set__('axios', {
      create: sinon.stub().returns(mockAxios),
      ...mockAxios,
    });
  });

  describe('create', () => {
    it('nominal', async () => {
      const session = await ChtSession.default.create(mockAuthInfo, 'user', 'pwd');
      expect(mockAxios.post.args[0][0]).to.be.a('string');
      expect(session.sessionToken).to.eq('AuthSession=123');
      expect(session.username).to.eq('user');
    });

    it('throw cht yields no authtoken', async () => {
      mockAxios.post.resolves(mockSessionResponse([]));
      await expect(ChtSession.default.create(mockAuthInfo, 'user', 'pwd')).to.eventually.be.rejectedWith('failed to obtain token');
    });

    it('throw if no user doc', async () => {
      mockAxios.get.rejects('404');
      await expect(ChtSession.default.create(mockAuthInfo, 'user', 'pwd')).to.eventually.be.rejectedWith();
    });

    it('throw if user-settings has no facility_id', async () => {
      mockAxios.get.resolves(mockUserFacilityDoc('', []));
      ChtSession.__set__('axios', mockAxios);

      await expect(ChtSession.default.create(mockAuthInfo, 'user', 'pwd')).to.eventually.be.rejectedWith('does not have a facility_id');
    });
  });

  it('createFromDataString', async () => {
    const session = await ChtSession.default.create(mockAuthInfo, 'user', 'pwd');
    const data = JSON.stringify(session);
    const actual = ChtSession.default.createFromDataString(data);
    expect(actual).to.deep.eq(session);
  });

  describe('isPlaceAuthorized', () => {
    const scenarios = [
      { roles: [], facilityId: 'parent-id', isExpected: true },
      { roles: [], facilityId: 'dne', isExpected: false },

      { roles: ['admin'], facilityId: 'parent-id', isExpected: true },
      { roles: ['admin'], facilityId: 'dne', isExpected: true },
      
      { roles: ['_admin'], facilityId: 'dne', isExpected: true }, // #102
    ];
    
    for (const scenario of scenarios) {
      it(JSON.stringify(scenario), async () => {
        mockAxios.get.resolves(mockUserFacilityDoc(scenario.facilityId, scenario.roles));

        const session = await ChtSession.default.create(mockAuthInfo, 'user', 'pwd');
        const place: RemotePlace = {
          id: '123',
          name: 'place', 
          lineage: ['parent-id', 'grandparent-id'],
          type: 'remote',
        };
        const actual = session.isPlaceAuthorized(place);
        expect(actual).to.eq(scenario.isExpected);
      });
    }
  });
});

