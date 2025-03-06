import Chai from 'chai';
import rewire from 'rewire';
import sinon from 'sinon';

import { mockChtSession } from './mocks';
const createUserManagers = rewire('../scripts/create-user-managers/create-user-managers');

import chaiAsPromised from 'chai-as-promised';
import RemotePlaceCache from '../src/lib/remote-place-cache';
Chai.use(chaiAsPromised);

const { expect } = Chai;

const StandardArgv = [
  'npx', 'ts-node', 'scripts/create-user-managers/index.ts',
  '--hostname', 'localhost:5988', '--adminUsername', 'medic', '--adminPassword', 'password'
];

let fakeGetPlacesWithType;
describe('scripts/create-user-managers.ts', () => {
  beforeEach(() => {
    RemotePlaceCache.clear();
    const session = mockChtSession('abc');
    const mockSession = {
      create: sinon.stub().resolves(session),
    };
    fakeGetPlacesWithType = sinon.stub().resolves([{
      _id: 'county_id',
      name: 'vihiga',
    }]);
    const mockChtApi = class MockChtApi {
      public chtSession = session;
      public getPlacesWithType = fakeGetPlacesWithType;

      public createContact = sinon.stub().resolves({});
      public createUser = sinon.stub().resolves({});
    };
    createUserManagers.__set__('ChtSession', mockSession);
    createUserManagers.__set__('ChtApi', mockChtApi);
  });

  it('nominal', async () => {
    const argv = [
      ...StandardArgv,
      '--names', 'Stan Lee',
      '--passwords', 'S3cret_abc',
      '--county', 'Vihiga',
    ];

    const actual = await createUserManagers.default(argv);
    expect(actual).to.have.property('length', 1);
    expect(actual[0]).to.deep.include({
      fullname: 'Stan Lee (User Manager)',
      password: 'S3cret_abc',
      phone: undefined,
      place: ['county_id'],
      roles: ['user_manager', 'mm-online'],
      username: 'stan_lee_user_manager',
    });
  });

  it('throw on mismatching names/passwords length ', async () => {
    const argv = [
      ...StandardArgv,
      '--names', 'Stan Lee', 'Frank Sinatra',
      '--passwords', 'S3cret_abc',
    ];
    await expect(createUserManagers.default(argv)).to.eventually.be.rejectedWith('2 users but 1 passwords');
  });

  it('throw on multiple counties ', async () => {
    const argv = [
      ...StandardArgv,
      '--names', 'Stan Lee',
    ];

    fakeGetPlacesWithType.resolves([
      {
        _id: 'county_id',
        name: 'vihiga',
      },
      {
        _id: 'county_id2',
        name: 'kakamega',
      }
    ]);

    await expect(createUserManagers.default(argv)).to.eventually.be.rejectedWith('multiple counties');
  });

  it('--county flag resolves ambiguous county', async () => {
    const argv = [
      ...StandardArgv,
      '--names', 'Stan Lee',
      '--county', 'Vihiga'
    ];

    fakeGetPlacesWithType.resolves([
      {
        id: 'county_id',
        name: 'vihiga',
        lineage: [],
        type: 'remote',
      },
      {
        id: 'county_id2',
        name: 'kakamega',
        lineage: [],
        type: 'remote',
      }
    ]);

    const actual = await createUserManagers.default(argv);
    expect(actual.length).to.eq(1);
  });
});
