import Chai from 'chai';
import MoveLib from '../../src/lib/move';
import { Config } from '../../src/config';
import SessionCache from '../../src/services/session-cache';
import { mockChtApi } from '../mocks';

import chaiAsPromised from 'chai-as-promised';
Chai.use(chaiAsPromised);

const { expect } = Chai;

describe('lib/move', () => {
  const chtApi = () => mockChtApi(
    [
      { id: 'from-sub', name: 'From Sub', lineage: [], type: 'remote' },
      { id: 'to-sub', name: 'To Sub', lineage: [], type: 'remote' }
    ],
    [{ id: 'chu-id', name: 'c-h-u', lineage: ['from-sub'], type: 'remote' }],
  );

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
    expect(actual.command).to.include('--url=https://user:password@domain');

    expect(actual.fromLineage.map((l:any) => l.id)).to.deep.eq(['chu-id', 'from-sub']);
    expect(actual.toLineage.map((l:any) => l.id)).to.deep.eq([undefined, 'to-sub']);
  });

  it('move CHU: subcounty required', async () => {
    const formData = {
      from_replacement: 'c-h-u',
      to_SUBCOUNTY: 'to sub',
    };
    const contactType = Config.getContactType('c_community_health_unit');
    const sessionCache = new SessionCache();

    const actual = MoveLib.move(formData, contactType, sessionCache, chtApi());
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

