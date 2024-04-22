import { expect } from 'chai';

import PlaceFactory from '../src/services/place-factory';
import SessionCache from '../src/services/session-cache';
import { mockChtApi, mockValidContactType } from './mocks';
import RemotePlaceCache from '../src/lib/remote-place-cache';


describe('warnings', () => {
  beforeEach(() => {
    RemotePlaceCache.clear({});
  });

  describe('unique: "all"', () => {
    it('local place and remote place share same name', async () => {
      const contactType = mockValidContactType('string', undefined);
      contactType.place_properties[0].unique = 'all';

      const remotePlace = { id: 'remote', name: 'CHU', type: 'remote' };
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
      expect(second.warnings).to.have.property('length', 1);
      expect(first.warnings[0]).to.include('staged');
      expect(first.warnings[0]).to.eq(second.warnings[0]);
    });
  });

  describe('unique: "parent"', () => {
    it('hi', () => {

    });
  });
});
