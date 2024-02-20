import { expect } from 'chai';
import rewire from 'rewire';
import sinon from 'sinon';
import { mockChtSession } from './mocks';

const createUserManagers = rewire('../scripts/create-user-managers/create-user-managers');

describe('scripts/create-user-managers.ts', () => {
  it('nominal', async () => {
    const argv = [
      'npx', 'ts-node', 'scripts/create-user-managers/index.ts',
      '--names', 'Stan Lee',
      '--passwords', 'S3cret_abc',
      '--county', 'Vihiga',
      '--hostname', 'localhost:5988',
      '--adminUsername', 'medic', '--adminPassword', 'password',
    ];

    const mockSession = {
      create: sinon.stub().resolves(mockChtSession('abc')),
    };
    const mockChtApi = class MockChtApi {
      public getPlacesWithType = sinon.stub().resolves([{
        id: 'county_id',
        name: 'vihiga',
        lineage: [],
        type: 'remote',
      }]);

      public createContact = sinon.stub().resolves({});
      public createUser = sinon.stub().resolves({});
    };
    createUserManagers.__set__('ChtSession', mockSession);
    createUserManagers.__set__('ChtApi', mockChtApi);

    const actual = await createUserManagers.default(argv);
    expect(actual).to.have.property('length', 1);
    expect(actual[0]).to.deep.include({
      fullname: 'Stan Lee',
      password: 'S3cret_abc',
      phone: undefined,
      place: 'county_id',
      type: 'user_manager',
      username: 'stan_lee',
    });
  });
});