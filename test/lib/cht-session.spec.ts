import Chai from 'chai';
import rewire from 'rewire';
import sinon from 'sinon';

import { AuthenticationInfo } from '../../src/config';
import { RemotePlace } from '../../src/lib/remote-place-cache';
import { AuthError } from '../../src/lib/authentication-error';
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
    facility_id: !facilityId ? undefined : facilityId,
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
      get: sinon.stub().resolves(mockUserFacilityDoc())
        .onSecondCall().resolves({ data: { version: { app: '4.7.0' } } }),
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
      expect(session.isAdmin).to.be.false;
    });

    it('throws AuthError for invalid credentials', async () => {
      mockAxios.post.rejects({ response: { status: 401 } });

      await expect(ChtSession.default.create(mockAuthInfo, 'user', 'wrong_pwd'))
        .to.be.rejectedWith('Invalid username or password')
        .and.to.eventually.be.instanceof(AuthError)
        .and.to.have.property('status', 401);
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
      await expect(ChtSession.default.create(mockAuthInfo, 'user', 'pwd')).to.eventually.be.rejectedWith('does not have a facility_id');
    });

    it('throw if cht-core is 4.6.5', async () => {
      mockAxios.get.onSecondCall().resolves({ data: { version: { app: '4.6.5' } } });
      await expect(ChtSession.default.create(mockAuthInfo, 'user', 'pwd')).to.eventually.be.rejectedWith('CHT Core Version must be');
    });
  });

  it('createFromDataString', async () => {
    const session = await ChtSession.default.create(mockAuthInfo, 'user', 'pwd');
    const data = JSON.stringify(session);
    const actual = ChtSession.default.createFromDataString(data);
    expect(actual).to.deep.eq(session);
    expect(session.isAdmin).to.be.false;
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

