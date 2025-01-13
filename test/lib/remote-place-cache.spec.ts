import { expect } from 'chai';

import { ChtDoc, mockChtApi, mockPlace, mockSimpleContactType } from '../mocks';
import { HierarchyConstraint } from '../../src/config';
import RemotePlaceCache from '../../src/lib/remote-place-cache';

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
    await RemotePlaceCache.getPlacesWithType(chtApi, contactType, contactTypeAsHierarchyLevel);
    expect(RemotePlaceCache.hasData(domain, contactType.name)).to.be.true;
    
    // Clear domain
    RemotePlaceCache.clear(chtApi);
    expect(RemotePlaceCache.hasData(domain, contactType.name)).to.be.false;
  });
});
