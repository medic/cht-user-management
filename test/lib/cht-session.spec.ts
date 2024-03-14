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

const mockUserFacilityDoc = (facilityId: string = 'parent-id', isAdmin: boolean = false) => ({
  data: {
    roles: isAdmin ? ['admin'] : [],
    facility_id: facilityId,
  }
});

describe('lib/cht-session.ts', () => {
  describe('create', () => {
    it('nominal', async () => {
      const mockAxios = {
        post: sinon.stub().resolves(mockSessionResponse()),
        get: sinon.stub().resolves(mockUserFacilityDoc()),
      };
      ChtSession.__set__('axios', mockAxios);

      const session = await ChtSession.default.create(mockAuthInfo, 'user', 'pwd');
      expect(mockAxios.post.args[0][0]).to.be.an('string');
      expect(session.sessionToken).to.eq('AuthSession=123');
      expect(session.username).to.eq('user');
    });

    it('throw cht yields no authtoken', async () => {
      const mockAxios = {
        post: sinon.stub().resolves(mockSessionResponse([])),
        get: sinon.stub().resolves(mockUserFacilityDoc()),
      };
      ChtSession.__set__('axios', mockAxios);

      await expect(ChtSession.default.create(mockAuthInfo, 'user', 'pwd')).to.eventually.be.rejectedWith('failed to obtain token');
    });

    it('throw if no user doc', async () => {
      const mockAxios = {
        post: sinon.stub().resolves(mockSessionResponse()),
        get: sinon.stub().rejects('404'),
      };
      ChtSession.__set__('axios', mockAxios);

      await expect(ChtSession.default.create(mockAuthInfo, 'user', 'pwd')).to.eventually.be.rejectedWith();
    });

    it('throw if user-settings has no facility_id', async () => {
      const mockAxios = {
        post: sinon.stub().resolves(mockSessionResponse()),
        get: sinon.stub().resolves(mockUserFacilityDoc('', false)),
      };
      ChtSession.__set__('axios', mockAxios);

      await expect(ChtSession.default.create(mockAuthInfo, 'user', 'pwd')).to.eventually.be.rejectedWith('does not have a facility_id');
    });
  });

  it('createFromDataString', async () => {
    const mockAxios = {
      post: sinon.stub().resolves(mockSessionResponse()),
      get: sinon.stub().resolves(mockUserFacilityDoc()),
    };
    ChtSession.__set__('axios', mockAxios);

    const session = await ChtSession.default.create(mockAuthInfo, 'user', 'pwd');
    const data = JSON.stringify(session);
    const actual = ChtSession.default.createFromDataString(data);
    expect(actual).to.deep.eq(session);
  });

  describe('isPlaceAuthorized', () => {
    const scenarios = [
      { isAdmin: false, facilityId: 'parent-id', isExpected: true },
      { isAdmin: false, facilityId: 'dne', isExpected: false },

      { isAdmin: true, facilityId: 'parent-id', isExpected: true },
      { isAdmin: true, facilityId: 'dne', isExpected: true },
    ];
    
    for (const scenario of scenarios) {
      it(JSON.stringify(scenario), async () => {
        const mockAxios = {
          post: sinon.stub().resolves(mockSessionResponse()),
          get: sinon.stub().resolves(mockUserFacilityDoc(scenario.facilityId, scenario.isAdmin)),
        };
        ChtSession.__set__('axios', mockAxios);

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

