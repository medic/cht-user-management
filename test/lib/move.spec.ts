import Chai from 'chai';
import sinon from 'sinon';

import MoveLib from '../../src/lib/move';
import { Config } from '../../src/config';
import SessionCache from '../../src/services/session-cache';
import { mockChtApi } from '../mocks';

import chaiAsPromised from 'chai-as-promised';
import Auth from '../../src/lib/authentication';
import { BullQueue } from '../../src/lib/queues';
Chai.use(chaiAsPromised);

const { expect } = Chai;

describe('lib/move.ts', () => {
  let moveContactQueue: any;

  beforeEach(() => {
    moveContactQueue = sinon.createStubInstance(BullQueue);
    sinon.stub(Auth, 'encodeTokenForWorker').returns('encoded-token');
  });

  afterEach(() => {
    sinon.restore();
  });

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
    
    const actual = await MoveLib.move(formData, contactType, sessionCache, chtApi(), moveContactQueue);
    expect(actual.fromLineage.map((l:any) => l.id)).to.deep.eq(['chu-id', 'from-sub']);
    expect(actual.toLineage.map((l:any) => l.id)).to.deep.eq([undefined, 'to-sub']);

    // Verify the data passed to mockmoveContactQueue
    expect(moveContactQueue.add.calledOnce).to.be.true;
    const jobParams = moveContactQueue.add.getCall(0).args[0];

    expect(jobParams).to.have.property('jobName').that.equals('move_[c-h-u]_from_[From Sub]_to_[To Sub]');
    expect(jobParams).to.have.property('jobData').that.deep.include({
      sourceId: 'chu-id',
      destinationId: 'to-sub',
      instanceUrl: 'http://domain.com',
      sessionToken: 'encoded-token',
    });
  });

  it('move CHU: subcounty required', async () => {
    const formData = {
      from_replacement: 'c-h-u',
      to_SUBCOUNTY: 'to sub',
    };
    const contactType = Config.getContactType('c_community_health_unit');
    const sessionCache = new SessionCache();

    const actual = MoveLib.move(formData, contactType, sessionCache, chtApi(), moveContactQueue);
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

    const actual = MoveLib.move(formData, contactType, sessionCache, chtApi(), moveContactQueue);
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

    const actual = MoveLib.move(formData, contactType, sessionCache, chtApi(), moveContactQueue);
    await expect(actual).to.eventually.be.rejectedWith('Cannot find \'b_sub_county\' matching \'Invalid Sub\'');
  });
});

