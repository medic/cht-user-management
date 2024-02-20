import { expect } from 'chai';

import { RemotePlace } from '../../src/lib/cht-api';
import RemotePlaceCache from '../../src/lib/remote-place-cache';
import SearchLib from '../../src/lib/search';
import { mockChtApi, mockValidContactType } from '../mocks';
import SessionCache from '../../src/services/session-cache';
import { Config } from '../../src/config';

describe('lib/remote-place-cache.ts', () => {
  beforeEach(() => {
    RemotePlaceCache.clear({});
  });

  const parentPlace: RemotePlace = {
    id: 'parent-id',
    name: 'parent',
    type: 'remote',
    lineage: [],
  };

  const toReplacePlace: RemotePlace = {
    id: 'to-replace',
    name: 'replace me',
    type: 'remote',
    lineage: [parentPlace.id],
  };

  it('simple search', async () => {
    const sessionCache = new SessionCache();
    const contactType = mockValidContactType('string', undefined);
    const formData = {
      hierarchy_replacement: 'me',
    };
    const chtApi = mockChtApi();
    chtApi.getPlacesWithType.resolves([toReplacePlace])
      .onSecondCall().resolves([parentPlace]);

    const [replacementLevel] = Config.getHierarchyWithReplacement(contactType);
    const actual = await SearchLib.search(contactType, formData, 'hierarchy_', replacementLevel, chtApi, sessionCache);
    expect(actual).to.deep.eq([toReplacePlace]);
  });

  it('data prefix', async () => {
    const sessionCache = new SessionCache();
    const contactType = mockValidContactType('string', undefined);
    const formData = {
      prefix_replacement: 'me',
    };
    const chtApi = mockChtApi();
    chtApi.getPlacesWithType.resolves([toReplacePlace])
      .onSecondCall().resolves([parentPlace]);

    const [replacementLevel] = Config.getHierarchyWithReplacement(contactType);
    const actual = await SearchLib.search(contactType, formData, 'prefix_', replacementLevel, chtApi, sessionCache);
    expect(actual).to.deep.eq([toReplacePlace]);
  });

  it('search constrained by parent', async () => {
    const sessionCache = new SessionCache();
    const ambiguity: RemotePlace = {
      id: 'ambiguous',
      name: 'me ambiguous',
      type: 'remote',
      lineage: ['other-parent'],
    };

    const contactType = mockValidContactType('string', undefined);
    const formData = {
      hierarchy_replacement: 'me',
      hierarchy_PARENT: 'paRent',
    };
    const chtApi = mockChtApi();
    chtApi.getPlacesWithType.resolves([toReplacePlace, ambiguity])
      .onSecondCall().resolves([parentPlace]);

    const [replacementLevel] = Config.getHierarchyWithReplacement(contactType);
    const actual = await SearchLib.search(contactType, formData, 'hierarchy_', replacementLevel, chtApi, sessionCache);
    expect(actual).to.deep.eq([toReplacePlace]);
  });
});

