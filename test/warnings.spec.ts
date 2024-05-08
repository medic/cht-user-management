import { expect } from 'chai';

import SessionCache from '../src/services/session-cache';
import { ChtDoc, createChu, mockChtApi } from './mocks';
import RemotePlaceCache from '../src/lib/remote-place-cache';
import { Config } from '../src/config';
import PlaceFactory from '../src/services/place-factory';

const subcounty: ChtDoc = {
  _id: 'subcounty1-id',
  name: 'subcounty1',
};
const subcounty2: ChtDoc = {
  _id: 'subcounty2-id',
  name: 'subcounty2',
};
const chuDoc: ChtDoc = {
  _id: 'chu',
  name: 'Abc CHU',
  parent: { _id: subcounty._id },
};
const chpDoc: ChtDoc = {
  _id: 'chp',
  name: 'Able Johnson Area',
  parent: { _id: chuDoc._id, parent: { _id: subcounty._id } },
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

  it('name warning after fuzzing of generated name on remote property', async () => {
    const sessionCache = new SessionCache();
    const chtApi = mockChtApi([subcounty], [chuDoc], [chpDoc]);

    const chuType = Config.getContactType('d_community_health_volunteer_area');
    const chpData = {
      hierarchy_SUBCOUNTY: subcounty.name,
      hierarchy_CHU: chuDoc.name,
      contact_name: 'able . johnson',
      contact_phone: '0712345678',
    };
    const chp = await PlaceFactory.createOne(chpData, chuType, sessionCache, chtApi);
    expect(chp.validationErrors).to.be.empty;

    expect(chp.warnings).to.have.property('length', 1);
    expect(chp.warnings[0]).to.include('"Community Health Promoter" with same "CHP Area Name"');
  });

  it('warn if two local try to replace the same remote', async () => {
    const sessionCache = new SessionCache();
    const chtApi = mockChtApi([subcounty], [chuDoc], [chpDoc]);

    const chuType = Config.getContactType('d_community_health_volunteer_area');
    const chpData = {
      hierarchy_SUBCOUNTY: subcounty.name,
      hierarchy_CHU: chuDoc.name,
      hierarchy_replacement: chpDoc.name,
      contact_name: 'new chp',
      contact_phone: '0712345678',
    };
    const first = await PlaceFactory.createOne(chpData, chuType, sessionCache, chtApi);
    expect(first.validationErrors).to.be.empty;

    chpData.contact_name = 'other chp';
    chpData.contact_phone = '0787654321';
    const second = await PlaceFactory.createOne(chpData, chuType, sessionCache, chtApi);
    expect(second.validationErrors).to.be.empty;

    expect(first.warnings).to.have.property('length', 1);
    expect(first.warnings[0]).to.include('Multiple entries are replacing the same "Community Health Promoter"');
    expect(second.warnings).to.deep.eq(first.warnings);
  });

  it('no name warning for generated names', async () => {
    const sessionCache = new SessionCache();
    const chtApi = mockChtApi([subcounty], [chuDoc], [chpDoc]);

    const chuType = Config.getContactType('d_community_health_volunteer_area');
    const chuData = {
      hierarchy_SUBCOUNTY: subcounty.name,
      hierarchy_CHU: chuDoc.name,
      contact_name: 'different name',
      contact_phone: '0712345678',
    };
    const chp = await PlaceFactory.createOne(chuData, chuType, sessionCache, chtApi);
    expect(chp.validationErrors).to.be.empty;
    expect(chp.warnings).to.be.empty;
  });

  it('can replace multiple CHAs at the same time without warning', async () => {
    const sessionCache = new SessionCache();
    const secondChu: ChtDoc = {
      _id: 'chu-2',
      name: 'second',
      parent: chuDoc.parent,
    };
    const chtApi = mockChtApi([subcounty], [chuDoc, secondChu]);

    const chuType = Config.getContactType('c_community_health_unit');
    const chuData = {
      hierarchy_SUBCOUNTY: subcounty.name,
      hierarchy_replacement: chuDoc.name,
      place_name: '',
      place_code: '',
      place_link_facility_name: '',
      place_link_facility_code: '',
      contact_name: 'replacement CHA',
      contact_phone: '0712345678',
    };
    const first = await PlaceFactory.createOne(chuData, chuType, sessionCache, chtApi);
    expect(first.validationErrors).to.be.empty;

    const secondChuData = {
      hierarchy_SUBCOUNTY: subcounty.name,
      hierarchy_replacement: secondChu.name,
      place_name: '',
      place_code: '',
      place_link_facility_name: '',
      place_link_facility_code: '',
      contact_name: 'another replacement',
      contact_phone: '0787654321',
    };
    const second = await PlaceFactory.createOne(secondChuData, chuType, sessionCache, chtApi);
    expect(second.validationErrors).to.be.empty;

    expect(first.warnings).to.be.empty;
    expect(second.warnings).to.be.empty;
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

  it('no warning when input is invalid', async () => {
    const chuCode = 'invalid';
    const remotePlace: ChtDoc = { _id: 'remote', name: 'remote', parent: { _id: subcounty._id }, code: chuCode };

    const sessionCache = new SessionCache();
    const chtApi = mockChtApi([subcounty], [remotePlace]);
    const first = await createChu(subcounty, 'abc', sessionCache, chtApi, { place_code: chuCode });

    expect(first.warnings).to.be.empty;
  });

  it('redundant warnings are not repeated', async () => {
    const chuCode = '111111';
    const chuName = 'abc';
    const remotePlace: ChtDoc = { _id: 'remote', name: chuName, parent: { _id: subcounty._id }, code: chuCode };

    const sessionCache = new SessionCache();
    const chtApi = mockChtApi([subcounty], [remotePlace]);
    const createIdenticalChu = async () => createChu(subcounty, chuName, sessionCache, chtApi, { place_code: chuCode });

    const first = await createIdenticalChu();
    const second = await createIdenticalChu();
    const third = await createIdenticalChu();
    const fourth = await createIdenticalChu();

    expect(first.warnings.length).to.eq(2);
    expect(second.warnings).to.deep.eq(first.warnings);
    expect(third.warnings).to.deep.eq(first.warnings);
    expect(fourth.warnings).to.deep.eq(first.warnings);
  });
});
