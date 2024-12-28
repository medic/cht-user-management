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
    uniqueKeys: {},
    lineage: [],
  };

  const contactType = mockSimpleContactType('string', undefined);
  const hierarchyLevel = contactType.hierarchy[0];

  it('cache miss', async () => {
    const chtApi = mockChtApi([doc]);
    const actual = await RemotePlaceCache.getPlacesWithType(chtApi, contactType, hierarchyLevel);
    expect(actual).to.have.property('length', 1);
    expect(actual[0]).to.deep.nested.include(docAsRemotePlace);
    expect(chtApi.getPlacesWithType.calledOnce).to.be.true;
  });

  it('cache hit', async () => {
    const chtApi = mockChtApi([doc]);
    
    await RemotePlaceCache.getPlacesWithType(chtApi, contactType, hierarchyLevel);
    const second = await RemotePlaceCache.getPlacesWithType(chtApi, contactType, hierarchyLevel);
    expect(second).to.have.property('length', 1);
    expect(second[0]).to.deep.nested.include(docAsRemotePlace);
    expect(chtApi.getPlacesWithType.calledOnce).to.be.true;
  });

  it('add', async () => {
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
    await RemotePlaceCache.getPlacesWithType(chtApi, contactType, contactTypeAsHierarchyLevel);
    RemotePlaceCache.add(place, chtApi);

    const second = await RemotePlaceCache.getPlacesWithType(chtApi, contactType, contactTypeAsHierarchyLevel);
    expect(second).to.have.property('length', 2);
    expect(second[0]).to.deep.nested.include(docAsRemotePlace);
    expect(second[1].id).to.eq(place.asRemotePlace().id);
    expect(chtApi.getPlacesWithType.calledOnce).to.be.true;
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
    await RemotePlaceCache.getPlacesWithType(chtApi, contactType, contactTypeAsHierarchyLevel);
    RemotePlaceCache.add(place, chtApi);
    
    chtApi.chtSession.authInfo.domain = 'http://other';
    RemotePlaceCache.clear(chtApi, 'other');
  });
});

