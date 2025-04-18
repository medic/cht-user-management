import { expect } from 'chai';

import { ChtDoc, mockChtApi, mockPlace, mockSimpleContactType } from '../mocks';
import { HierarchyConstraint } from '../../src/config';
import RemotePlaceCache from '../../src/lib/remote-place-cache';
import sinon from 'sinon';

describe('lib/remote-place-cache.ts', () => {
  beforeEach(() => {
    RemotePlaceCache.clear({});
  });

  const doc: ChtDoc = {
    _id: 'parent-id',
    name: 'parent',
  };

  const docAsRemotePlace = {
    id: doc._id,
    'name.original': doc.name,
    type: 'remote',
    lineage: [],
  };

  const contactType = mockSimpleContactType('string', undefined);

  it('cache miss', async () => {
    const chtApi = mockChtApi([doc], [], [doc], []);
    await RemotePlaceCache.getRemotePlaces(chtApi, contactType);
    RemotePlaceCache.clear(chtApi);
    const actual = await RemotePlaceCache.getRemotePlaces(chtApi, contactType);
    expect(actual).to.have.property('length', 1);
    expect(actual[0]).to.deep.nested.include(docAsRemotePlace);
    expect(chtApi.getPlacesWithType.callCount).to.eq(4);
  });

  it('cache hit', async () => {
    const chtApi = mockChtApi([doc]);

    await RemotePlaceCache.getRemotePlaces(chtApi, contactType);
    expect(chtApi.getPlacesWithType.callCount).to.eq(2);

    const second = await RemotePlaceCache.getRemotePlaces(chtApi, contactType);
    expect(second).to.have.property('length', 1);
    expect(second[0]).to.deep.nested.include(docAsRemotePlace);
    expect(chtApi.getPlacesWithType.callCount).to.eq(2);
  });

  it('add', async () => {
    const contactType = mockSimpleContactType('string', undefined);
    const place = mockPlace(contactType, 'prop');
    const chtApi = mockChtApi([doc]);
    
    await RemotePlaceCache.getRemotePlaces(chtApi, contactType);
    expect(chtApi.getPlacesWithType.callCount).to.eq(2);
    
    RemotePlaceCache.add(place, chtApi);

    const second = await RemotePlaceCache.getRemotePlaces(chtApi, contactType);
    expect(second).to.have.property('length', 2);
    expect(second[0]).to.deep.nested.include(docAsRemotePlace);
    expect(second[1].id).to.eq(place.asRemotePlace().id);
    expect(chtApi.getPlacesWithType.callCount).to.eq(2);
  });

  it('clear', async () => {
    const contactType = mockSimpleContactType('string', undefined);
    const place = mockPlace(contactType, 'prop');
    const chtApi = mockChtApi([doc]);

    const contactTypeAsHierarchyLevel: HierarchyConstraint = {
      contact_type: contactType.name,
      property_name: 'level',
      friendly_name: 'pretend another ContactType needs this',
      type: 'name',
      required: true,
      level: 0,
    };
    await RemotePlaceCache.getRemotePlaces(chtApi, contactType, contactTypeAsHierarchyLevel);
    RemotePlaceCache.add(place, chtApi);

    chtApi.chtSession.authInfo.domain = 'http://other';
    RemotePlaceCache.clear(chtApi, 'other');
  });

  it('unique key properties', async () => {
    const chtApi = mockChtApi([{_id: 'id', name: 1 }]);
    const contactType = mockSimpleContactType('string', undefined);
    contactType.place_properties.find(p => p.property_name === 'name').unique = 'all';
    const contactTypeAsHierarchyLevel: HierarchyConstraint = {
      contact_type: contactType.name,
      property_name: 'level',
      friendly_name: 'pretend another ContactType needs this',
      type: 'name',
      required: true,
      level: 0,
    };
    try {
      await RemotePlaceCache.getRemotePlaces(chtApi, contactType, contactTypeAsHierarchyLevel);
    } catch (e) {
      expect(e).to.be.undefined;
    }
  });

  it('clears all place types when clearing domain', async () => {
    const chtApi = mockChtApi([doc]);
    const domain = chtApi.chtSession.authInfo.domain;

    const contactTypeAsHierarchyLevel: HierarchyConstraint = {
      contact_type: contactType.name,
      property_name: 'level',
      friendly_name: 'pretend another ContactType needs this',
      type: 'name',
      required: true,
      level: 0,
    };
    await RemotePlaceCache.getRemotePlaces(chtApi, contactType, contactTypeAsHierarchyLevel);

    const key = (RemotePlaceCache as any).getCacheKey(domain, contactType.name);
    expect(!!(RemotePlaceCache as any).cache.get(key)).to.be.true;

    // Clear domain
    RemotePlaceCache.clear(chtApi);
    expect(!!(RemotePlaceCache as any).cache.get(key)).to.be.false;
  });

  it('should only make a single call when multiple requests happen', async () => {
    const doc = { _id: 'parent-id', name: 'parent' };
    const chtApi = mockChtApi([doc]);
    
    // Add a delay to the getPlacesWithType method to simulate a slow response
    const originalGetPlacesWithType = chtApi.getPlacesWithType;
    chtApi.getPlacesWithType = sinon.stub().callsFake(async function(...args) {
      await new Promise(resolve => setTimeout(resolve, 50));
      return originalGetPlacesWithType.apply(this, args);
    });
    
    const promise1 = RemotePlaceCache.getRemotePlaces(chtApi, contactType);
    const promise2 = RemotePlaceCache.getRemotePlaces(chtApi, contactType);
    const promise3 = RemotePlaceCache.getRemotePlaces(chtApi, contactType);
    
    // call all promises
    const [result1, result2, result3] = await Promise.all([promise1, promise2, promise3]);
    
    // Verify that all promises returned the same data
    expect(result1).to.have.property('length', 1);
    expect(result2).to.have.property('length', 1);
    expect(result3).to.have.property('length', 1);
    
    expect(chtApi.getPlacesWithType.callCount).to.eq(2);
    
    expect(result1[0]).to.deep.equal(result2[0]);
    expect(result2[0]).to.deep.equal(result3[0]);
    expect(result1[0]).to.deep.nested.include({
      id: doc._id,
      'name.original': doc.name,
      type: 'remote'
    });
  });
});
