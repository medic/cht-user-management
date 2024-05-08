import Chai from 'chai';
import MoveLib from '../../src/lib/move';
import { Config } from '../../src/config';
import SessionCache from '../../src/services/session-cache';
import { mockChtApi } from '../mocks';

import chaiAsPromised from 'chai-as-promised';
import RemotePlaceCache from '../../src/lib/remote-place-cache';
Chai.use(chaiAsPromised);

const { expect } = Chai;

describe('lib/move.ts', () => {
  beforeEach(() => {
    RemotePlaceCache.clear({});
  });

  const subcountyDocs = [
    { _id: 'from-sub', name: 'From Sub' },
    { _id: 'to-sub', name: 'To Sub' }
  ];
  const chuDocs = [
    { _id: 'chu-id', name: 'c-h-u', parent: { _id: 'from-sub' } },
  ];

  const chtApi = () => mockChtApi(subcountyDocs, chuDocs);

  it('move CHU: success', async () => {
    const formData = {
      from_replacement: 'c-h-u',
      from_SUBCOUNTY: 'from sub',
      to_SUBCOUNTY: 'to sub',
    };
    const contactType = Config.getContactType('c_community_health_unit');
    const sessionCache = new SessionCache();
    
    const actual = await MoveLib.move(formData, contactType, sessionCache, chtApi());
    expect(actual.command).to.include('--contacts=chu-id');
    expect(actual.command).to.include('--parent=to-sub');
    expect(actual.command).to.include('--url=http://username:password@domain.com', actual.command);

    expect(actual.fromLineage.map((l:any) => l.id)).to.deep.eq(['from-sub', 'chu-id']);
    expect(actual.toLineage.map((l:any) => l.id)).to.deep.eq([undefined, 'to-sub']);
  });

  it('move CHU: subcounty required', async () => {
    const formData = {
      from_replacement: 'c-h-u',
      to_SUBCOUNTY: 'to sub',
    };
    const contactType = Config.getContactType('c_community_health_unit');
    const sessionCache = new SessionCache();

    const actual = MoveLib.move(formData, contactType, sessionCache, mockChtApi([], chuDocs));
    await expect(actual).to.eventually.be.rejectedWith('search string is empty');
  });

  it('move CHU: cant move to same place', async () => {
    const formData = {
      from_replacement: 'c-h-u',
      from_SUBCOUNTY: 'from SUB',
      to_SUBCOUNTY: 'from sub',
    };
    const contactType = Config.getContactType('c_community_health_unit');
    const sessionCache = new SessionCache();

    const actual = MoveLib.move(formData, contactType, sessionCache, chtApi());
    await expect(actual).to.eventually.be.rejectedWith('Place "c-h-u" already has "From Sub" as parent');
  });

  it('move CHU: fail to resolve parent', async () => {
    const formData = {
      from_replacement: 'c-h-u',
      from_SUBCOUNTY: 'from SUB',
      to_SUBCOUNTY: 'invalid sub',
    };
    const contactType = Config.getContactType('c_community_health_unit');
    const sessionCache = new SessionCache();

    const actual = MoveLib.move(formData, contactType, sessionCache, chtApi());
    await expect(actual).to.eventually.be.rejectedWith('Cannot find \'b_sub_county\' matching \'invalid sub\'');
  });
});

