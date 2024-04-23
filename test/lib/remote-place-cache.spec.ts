import { expect } from 'chai';

import RemotePlaceCache, { RemotePlace } from '../../src/lib/remote-place-cache';
import { ChtDoc, mockChtApi, mockPlace, mockSimpleContactType } from '../mocks';

describe('lib/remote-place-cache.ts', () => {
  beforeEach(() => {
    RemotePlaceCache.clear({});
  });

  const doc: ChtDoc = {
    _id: 'parent-id',
    name: 'parent',
  };

  const docAsRemotePlace: RemotePlace = {
    id: doc._id,
    name: doc.name,
    type: 'remote',
    uniqueKeys: {},
    lineage: [],
  };

  it('cache miss', async () => {
    const chtApi = mockChtApi([doc]);
    const actual = await RemotePlaceCache.getPlacesWithType(chtApi, 'type');
    expect(actual).to.deep.eq([docAsRemotePlace]);
    expect(chtApi.getPlacesWithType.calledOnce).to.be.true;
  });

  it('cache hit', async () => {
    const chtApi = mockChtApi([doc]);
    await RemotePlaceCache.getPlacesWithType(chtApi, 'type');
    const second = await RemotePlaceCache.getPlacesWithType(chtApi, 'type');
    expect(second).to.deep.eq([docAsRemotePlace]);
    expect(chtApi.getPlacesWithType.calledOnce).to.be.true;
  });

  it('add', async () => {
    const contactType = mockSimpleContactType('unknown`', undefined);
    const place = mockPlace(contactType, 'prop');

    const chtApi = mockChtApi([doc]);
    await RemotePlaceCache.add(place, chtApi);

    const second = await RemotePlaceCache.getPlacesWithType(chtApi, contactType.name);
    expect(second).to.deep.eq([docAsRemotePlace, place.asRemotePlace()]);
    expect(chtApi.getPlacesWithType.calledOnce).to.be.true;
  });
});

