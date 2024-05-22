import { expect } from 'chai';
import { ChtDoc, createChu, mockChtApi } from '../mocks';
import createZip from '../../src/services/files';
import SessionCache from '../../src/services/session-cache';

const subcounty: ChtDoc = {
  _id: 'subcounty1-id',
  name: 'subcounty1',
};

describe('services/files.ts', () => {
  it('nominal', async () => {
    const sessionCache = new SessionCache();
    const chtApi = mockChtApi([subcounty]);
    await createChu(subcounty, 'File CHU', sessionCache, chtApi);

    const actual = createZip(sessionCache);
    expect(Object.keys(actual.files)).to.deep.eq(['c_community_health_unit.csv']);
  });
});
