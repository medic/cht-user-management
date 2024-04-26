import { expect } from 'chai';

import PlaceFactory from '../src/services/place-factory';
import SessionCache from '../src/services/session-cache';
import { ChtDoc, createChu, mockChtApi, mockValidContactType } from './mocks';
import RemotePlaceCache from '../src/lib/remote-place-cache';

const subcounty: ChtDoc = {
  _id: 'subcounty1-id',
  name: 'subcounty1',
};
const subcounty2: ChtDoc = {
  _id: 'subcounty2-id',
  name: 'subcounty2',
};

describe('warnings', () => {
  beforeEach(() => {
    RemotePlaceCache.clear({});
  });

  describe('using mock contact types', () => {
    it('local place and remote place share same name', async () => {
      const contactType = mockValidContactType('string', undefined);
      contactType.place_properties[0].unique = 'all';

      const remotePlace: ChtDoc = { _id: 'remote', name: 'CHU' };
      const chtApi = mockChtApi([remotePlace]);
      const fakeFormData:any = {
        place_name: 'CHU',
        place_prop: 'foo',
        contact_name: 'contact',
      };

      const sessionCache = new SessionCache();
      const place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
      expect(place.warnings).to.have.property('length', 1);
      expect(place.warnings[0]).to.include('exists');
    });

    it('two local places share same name', async () => {
      const contactType = mockValidContactType('string', undefined);
      contactType.place_properties[0].unique = 'all';

      const chtApi = mockChtApi([]);
      const fakeFormData:any = {
        place_name: 'CHU',
        place_prop: 'foo',
        contact_name: 'contact',
      };

      const sessionCache = new SessionCache();
      const first = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
      expect(first.warnings).to.have.property('length', 0);
      const second = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
      expect(first.warnings).to.have.property('length', 1);
      expect(first.warnings[0]).to.include('staged');
      expect(first.warnings).to.deep.eq(second.warnings);
    });
  });

  describe('using KE config.json contact types', () => {
    it('no warnings', async () => {
      const sessionCache = new SessionCache();
      const chtApi = mockChtApi([subcounty], []);
      const first = await createChu(subcounty, 'chu-1', sessionCache, chtApi);
      const second = await createChu(subcounty, 'chu-2', sessionCache, chtApi, { place_code: '121212' });

      expect(first.warnings).to.have.property('length', 0);
    });

    it('two local places share same name and same parent', async () => {
      const sessionCache = new SessionCache();
      const chtApi = mockChtApi([subcounty], []);
      const first = await createChu(subcounty, 'chu', sessionCache, chtApi);
      const second = await createChu(subcounty, 'chu', sessionCache, chtApi, { place_code: '121212' });

      expect(first.warnings).to.have.property('length', 1);
      expect(first.warnings[0]).to.include('Another "Community Health Unit" with same "CHU Name"');
      expect(first.warnings).to.deep.eq(second.warnings);
    });

    it('duplicate names but only after fuzzing', async () => {
      const sessionCache = new SessionCache();
      const chtApi = mockChtApi([subcounty], []);
      const first = await createChu(subcounty, 'ABC Community Health Unit', sessionCache, chtApi);
      const second = await createChu(subcounty, 'abc', sessionCache, chtApi, { place_code: '121212' });

      expect(first.warnings).to.have.property('length', 1);
      expect(first.warnings[0]).to.include('Another "Community Health Unit" with same "CHU Name"');
      expect(first.warnings).to.deep.eq(second.warnings);
    });

    it('CHU is duplicate of remote place after fuzzing', async () => {
      const remotePlace: ChtDoc = { _id: 'remote-chu', name: 'Abc Community Health Unit', parent: { _id: subcounty._id } };
      
      const sessionCache = new SessionCache();
      const chtApi = mockChtApi([subcounty], [remotePlace]);
      const first = await createChu(subcounty, 'abc', sessionCache, chtApi);

      expect(first.warnings).to.have.property('length', 1);
      expect(first.warnings[0]).to.include('Another "Community Health Unit" with same "CHU Name"');
      expect(first.warnings).to.deep.eq(first.warnings);
    });

    it('two local places with duplicate CHU Code', async () => {
      const sessionCache = new SessionCache();
      const chtApi = mockChtApi([subcounty, subcounty2], []);
      const first = await createChu(subcounty, 'chu-1', sessionCache, chtApi);
      const second = await createChu(subcounty2, 'chu-2', sessionCache, chtApi);

      expect(first.warnings).to.have.property('length', 1);
      expect(first.warnings[0]).to.include('Another "Community Health Unit" with same "CHU Code"');
      expect(first.warnings).to.deep.eq(second.warnings);
    });

    it('local and remote places with duplicate CHU Code', async () => {
      const chuCode = '111111';
      const remotePlace: ChtDoc = { _id: 'remote', name: 'remote', parent: { _id: subcounty._id }, code: chuCode };
      
      const sessionCache = new SessionCache();
      const chtApi = mockChtApi([subcounty], [remotePlace]);
      const first = await createChu(subcounty, 'abc', sessionCache, chtApi, { place_code: chuCode });

      expect(first.warnings).to.have.property('length', 1);
      expect(first.warnings[0]).to.include('Another "Community Health Unit" with same "CHU Code"');
    });

    it('local place and remote place share same name but different parents', async () => {
      const sessionCache = new SessionCache();
      const chtApi = mockChtApi([subcounty, subcounty2], []);
      const first = await createChu(subcounty, 'chu', sessionCache, chtApi);
      const second = await createChu(subcounty2, 'chu', sessionCache, chtApi, { place_code: '121212' });

      expect(first.warnings).to.have.property('length', 0);
    });
  });
});
