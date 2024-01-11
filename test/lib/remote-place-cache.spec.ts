import { expect } from 'chai';

import { RemotePlace } from '../../src/lib/cht-api';
import RemotePlaceCache from '../../src/lib/remote-place-cache';
import { mockChtApi, mockPlace, mockSimpleContactType } from '../mocks';

describe('lib/remote-place-cache.ts', () => {
  beforeEach(() => {
    RemotePlaceCache.clear({});
  });

  const remotePlace: RemotePlace = {
    id: 'parent-id',
    name: 'parent',
    type: 'remote',
    lineage: [],
  };

  it('cache miss', async () => {
    const chtApi = mockChtApi([remotePlace]);
    const actual = await RemotePlaceCache.getPlacesWithType(chtApi, 'type');
    expect(actual).to.deep.eq([remotePlace]);
    expect(chtApi.getPlacesWithType.calledOnce).to.be.true;
  });

  it('cache hit', async () => {
    const chtApi = mockChtApi([remotePlace]);
    await RemotePlaceCache.getPlacesWithType(chtApi, 'type');
    const second = await RemotePlaceCache.getPlacesWithType(chtApi, 'type');
    expect(second).to.deep.eq([remotePlace]);
    expect(chtApi.getPlacesWithType.calledOnce).to.be.true;
  });

  it('add', async () => {
    const contactType = mockSimpleContactType('unknown`', undefined);
    const place = mockPlace(contactType, 'prop');

    const chtApi = mockChtApi([remotePlace]);
    await RemotePlaceCache.add(place, chtApi);

    const second = await RemotePlaceCache.getPlacesWithType(chtApi, contactType.name);
    expect(second).to.deep.eq([remotePlace, place.asRemotePlace()]);
    expect(chtApi.getPlacesWithType.calledOnce).to.be.true;
  });
});

