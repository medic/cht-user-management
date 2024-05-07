import { expect } from 'chai';

import SessionCache from '../src/services/session-cache';
import { ChtDoc, createChu, mockChtApi } from './mocks';
import RemotePlaceCache from '../src/lib/remote-place-cache';

const subcounty: ChtDoc = {
  _id: 'subcounty1-id',
  name: 'subcounty1',
};
const subcounty2: ChtDoc = {
  _id: 'subcounty2-id',
  name: 'subcounty2',
};

/*
Note: These tests have a dependency on Kenya eCHIS config.json and cannot rely on mocked contact types
This is because RemotePlaceCache makes a call to Config.getUniqueKeysFor() without passing through a ContactType

It is quite difficult to resolve. Not all fetched information has a corresponding ContactType.
*/
describe('warnings', () => {
  beforeEach(() => {
    RemotePlaceCache.clear({});
  });

  it('no warnings', async () => {
    const sessionCache = new SessionCache();
    const chtApi = mockChtApi([subcounty], []);
    const first = await createChu(subcounty, 'chu-1', sessionCache, chtApi);
    const second = await createChu(subcounty, 'chu-2', sessionCache, chtApi, { place_code: '121212' });

    expect(first.warnings).to.have.property('length', 0);
    expect(second.warnings).to.deep.eq(first.warnings);
  });

  it('two local places share same name and same parent', async () => {
    const sessionCache = new SessionCache();
    const chtApi = mockChtApi([subcounty], []);
    const first = await createChu(subcounty, 'chu', sessionCache, chtApi);
    const second = await createChu(subcounty, 'chu', sessionCache, chtApi, { place_code: '121212' });

    expect(first.warnings).to.have.property('length', 1);
    expect(first.warnings[0]).to.include('"Community Health Unit" with same "CHU Name"');
    expect(second.warnings).to.deep.eq(first.warnings);
  });

  it('duplicate names but only after fuzzing', async () => {
    const sessionCache = new SessionCache();
    const chtApi = mockChtApi([subcounty], []);
    const first = await createChu(subcounty, 'ABC Community Health Unit', sessionCache, chtApi);
    const second = await createChu(subcounty, 'abc', sessionCache, chtApi, { place_code: '121212' });

    expect(first.warnings).to.have.property('length', 1);
    expect(first.warnings[0]).to.include('"Community Health Unit" with same "CHU Name"');
    expect(second.warnings).to.deep.eq(first.warnings);
  });

  it('CHU is duplicate of remote place after fuzzing', async () => {
    const remotePlace: ChtDoc = { _id: 'remote-chu', name: 'Abc Community Health Unit', parent: { _id: subcounty._id } };

    const sessionCache = new SessionCache();
    const chtApi = mockChtApi([subcounty], [remotePlace]);
    const first = await createChu(subcounty, 'abc', sessionCache, chtApi);

    expect(first.warnings).to.have.property('length', 1);
    expect(first.warnings[0]).to.include('"Community Health Unit" with same "CHU Name"');
    expect(first.warnings).to.deep.eq(first.warnings);
  });

  it('two local places with duplicate CHU Code', async () => {
    const sessionCache = new SessionCache();
    const chtApi = mockChtApi([subcounty, subcounty2], []);
    const first = await createChu(subcounty, 'chu-1', sessionCache, chtApi);
    const second = await createChu(subcounty2, 'chu-2', sessionCache, chtApi);

    expect(first.warnings).to.have.property('length', 1);
    expect(first.warnings[0]).to.include('"Community Health Unit" with same "CHU Code"');
    expect(first.warnings).to.deep.eq(second.warnings);
  });

  it('local and remote places with duplicate CHU Code', async () => {
    const chuCode = '111111';
    const remotePlace: ChtDoc = { _id: 'remote', name: 'remote', parent: { _id: subcounty._id }, code: chuCode };

    const sessionCache = new SessionCache();
    const chtApi = mockChtApi([subcounty], [remotePlace]);
    const first = await createChu(subcounty, 'abc', sessionCache, chtApi, { place_code: chuCode });

    expect(first.warnings).to.have.property('length', 1);
    expect(first.warnings[0]).to.include('"Community Health Unit" with same "CHU Code"');
  });

  it('no warning when local place and remote place share same name but different parents', async () => {
    const sessionCache = new SessionCache();
    const chtApi = mockChtApi([subcounty, subcounty2], []);
    const first = await createChu(subcounty, 'chu', sessionCache, chtApi);
    const second = await createChu(subcounty2, 'chu', sessionCache, chtApi, { place_code: '121212' });

    expect(first.warnings).to.have.property('length', 0);
    expect(second.warnings).to.deep.eq(first.warnings);
  });
});
