import { expect } from 'chai';

import PlaceFactory from '../src/services/place-factory';
import SessionCache from '../src/services/session-cache';
import { ChtDoc, createChu, mockChtApi, mockValidContactType } from './mocks';
import RemotePlaceCache, { RemotePlace } from '../src/lib/remote-place-cache';


describe('warnings', () => {
  beforeEach(() => {
    RemotePlaceCache.clear({});
  });

  describe('unique: "all"', () => {
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

  describe('unique: "parent"', () => {
    it('two local places share same name and same parent', async () => {
      const sessionCache = new SessionCache();
      const subcounty: ChtDoc = {
        _id: 'subcounty-id',
        name: 'subcounty-name',
      };
      const chtApi = mockChtApi([subcounty], []);
      const first = await createChu(subcounty, 'chu', sessionCache, chtApi);
      const second = await createChu(subcounty, 'chu', sessionCache, chtApi, { place_code: '121212' });

      expect(first.warnings).to.have.property('length', 1);
      console.log(first.warnings);
      expect(first.warnings[0]).to.include('Another "Community Health Unit" with same "CHU Name"');
      expect(first.warnings).to.deep.eq(second.warnings);
    });

    // it('local place and remote place share same name but different parents', () => {

    // });
  });
});
