import { expect } from 'chai';

import RemotePlaceCache, { RemotePlace } from '../../src/lib/remote-place-cache';
import SearchLib from '../../src/lib/search';
import { ChtDoc, mockChtApi, mockChtSession, mockValidContactType } from '../mocks';
import SessionCache from '../../src/services/session-cache';
import { Config } from '../../src/config';
import RemotePlaceResolver from '../../src/lib/remote-place-resolver';

describe('lib/search.ts', () => {
  beforeEach(() => {
    RemotePlaceCache.clear({});
  });

  const parentPlace: ChtDoc = {
    _id: 'parent-id',
    name: 'parent',
    parent: { _id: 'grandparent-id' },
  };

  const toReplacePlace: ChtDoc = {
    _id: 'to-replace',
    name: 'replace me',
    parent: { _id: parentPlace._id, parent: parentPlace.parent },
  };

  it('simple search', async () => {
    const sessionCache = new SessionCache();
    const contactType = mockValidContactType('string', undefined);
    const formData = {
      hierarchy_replacement: 'me',
    };
    const chtApi = mockChtApi([], [parentPlace], [toReplacePlace]);
    const [replacementLevel] = Config.getHierarchyWithReplacement(contactType);
    const actual = await SearchLib.search(contactType, formData, 'hierarchy_', replacementLevel, chtApi, sessionCache);
    assertPlaceMatchesDoc(actual, [toReplacePlace]);
  });

  it('data prefix', async () => {
    const sessionCache = new SessionCache();
    const contactType = mockValidContactType('string', undefined);
    const formData = {
      prefix_replacement: 'me',
    };
    const chtApi = mockChtApi([], [parentPlace], [toReplacePlace]);

    const [replacementLevel] = Config.getHierarchyWithReplacement(contactType);
    const actual = await SearchLib.search(contactType, formData, 'prefix_', replacementLevel, chtApi, sessionCache);
    assertPlaceMatchesDoc(actual, [toReplacePlace]);
  });

  it('search constrained by parent', async () => {
    const sessionCache = new SessionCache();
    const ambiguity: ChtDoc = {
      _id: 'ambiguous',
      name: 'me ambiguous',
      parent: { _id: 'other-parent', parent: parentPlace.parent },
    };

    const contactType = mockValidContactType('string', undefined);
    const formData = {
      hierarchy_replacement: 'me',
      hierarchy_PARENT: 'paRent',
    };
    const chtApi = mockChtApi([], [parentPlace], [toReplacePlace, ambiguity]);
    const [replacementLevel] = Config.getHierarchyWithReplacement(contactType);
    const actual = await SearchLib.search(contactType, formData, 'hierarchy_', replacementLevel, chtApi, sessionCache);
    assertPlaceMatchesDoc(actual, [toReplacePlace]);
  });

  it('ignores accents', async () => {
    const sessionCache = new SessionCache();
    const contactType = mockValidContactType('string', undefined);
    const formData = {
      hierarchy_replacement: 'plÀce',
    };
    const chtApi = mockChtApi([], [parentPlace], [toReplacePlace]);

    const [replacementLevel] = Config.getHierarchyWithReplacement(contactType);
    const actual = await SearchLib.search(contactType, formData, 'hierarchy_', replacementLevel, chtApi, sessionCache);
    assertPlaceMatchesDoc(actual, [toReplacePlace]);
  });

  it('search unsuccessful when result is not child of user facility', async () => {
    const sessionCache = new SessionCache();
    const contactType = mockValidContactType('string', undefined);
    const formData = {
      hierarchy_replacement: 'me',
    };
    const chtApi = mockChtApi([], [parentPlace], [toReplacePlace]);
    chtApi.chtSession = mockChtSession('other');

    const [replacementLevel] = Config.getHierarchyWithReplacement(contactType);
    const actual = await SearchLib.search(contactType, formData, 'hierarchy_', replacementLevel, chtApi, sessionCache);
    expect(actual).to.deep.eq([RemotePlaceResolver.NoResult]);
  });
});

function assertPlaceMatchesDoc(remotePlace: RemotePlace[], docs: ChtDoc[]) {
  const remotePlaceIds = remotePlace.map(a => a.id);
  const docIds = docs.map(doc => doc._id);
  expect(remotePlaceIds).to.deep.eq(docIds);
}

