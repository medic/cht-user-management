import Chai from 'chai';
import sinon from 'sinon';

import ManageHierarchyLib from '../../src/lib/manage-hierarchy';
import { Config } from '../../src/config';
import SessionCache from '../../src/services/session-cache';
import { mockChtApi } from '../mocks';

import chaiAsPromised from 'chai-as-promised';
import Auth from '../../src/lib/authentication';
import { BullQueue } from '../../src/lib/queues';
Chai.use(chaiAsPromised);

const { expect } = Chai;

describe('lib/manage-hierarchy.ts', () => {
  let chtConfQueue: any;

  beforeEach(() => {
    chtConfQueue = sinon.createStubInstance(BullQueue);
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
    [
      { id: 'from-chu-id', name: 'c-h-u', lineage: ['from-sub'], type: 'remote' },
      { id: 'to-chu-id', name: 'destination', lineage: ['to-sub'], type: 'remote' }
    ],
  );

  describe('move', () => {
    it('move CHU: success', async () => {    
      const formData = {
        op: 'move',
        source_replacement: 'c-h-u',
        source_SUBCOUNTY: 'from sub',
        destination_SUBCOUNTY: 'to sub',
      };
      const contactType = Config.getContactType('c_community_health_unit');
      const sessionCache = new SessionCache();
      
      const actual = await ManageHierarchyLib.scheduleJob(formData, contactType, sessionCache, chtApi(), chtConfQueue);
      expect(actual.sourceLineage.map((l:any) => l.id)).to.deep.eq(['from-chu-id', 'from-sub']);
      expect(actual.destinationLineage.map((l:any) => l.id)).to.deep.eq([undefined, 'to-sub']);

      // Verify the data passed to mockmoveContactQueue
      expect(chtConfQueue.add.calledOnce).to.be.true;
      const jobParams = chtConfQueue.add.getCall(0).args[0];

      expect(jobParams).to.have.property('jobName').that.equals('move_[From Sub.c-h-u]_to_[To Sub]');
      expect(jobParams).to.have.property('jobData').that.deep.include({
        action: 'move',
        sourceId: 'from-chu-id',
        destinationId: 'to-sub',
        instanceUrl: 'http://domain.com',
        sessionToken: 'encoded-token',
      });
    });

    it('move CHU: subcounty required', async () => {
      const formData = {
        op: 'move',
        source_replacement: 'c-h-u',
        destination_SUBCOUNTY: 'to sub',
      };
      const contactType = Config.getContactType('c_community_health_unit');
      const sessionCache = new SessionCache();

      const actual = ManageHierarchyLib.scheduleJob(formData, contactType, sessionCache, chtApi(), chtConfQueue);
      await expect(actual).to.eventually.be.rejectedWith('search string is empty');
    });

    it('move CHU: cant move to same place', async () => {
      const formData = {
        op: 'move',
        source_replacement: 'c-h-u',
        source_SUBCOUNTY: 'from SUB',
        destination_SUBCOUNTY: 'from sub',
      };
      const contactType = Config.getContactType('c_community_health_unit');
      const sessionCache = new SessionCache();

      const actual = ManageHierarchyLib.scheduleJob(formData, contactType, sessionCache, chtApi(), chtConfQueue);
      await expect(actual).to.eventually.be.rejectedWith('Place "c-h-u" already has "From Sub" as parent');
    });

    it('move CHU: fail to resolve parent', async () => {
      const formData = {
        op: 'move',
        source_replacement: 'c-h-u',
        source_SUBCOUNTY: 'from SUB',
        destination_SUBCOUNTY: 'invalid sub',
      };
      const contactType = Config.getContactType('c_community_health_unit');
      const sessionCache = new SessionCache();

      const actual = ManageHierarchyLib.scheduleJob(formData, contactType, sessionCache, chtApi(), chtConfQueue);
      await expect(actual).to.eventually.be.rejectedWith('Cannot find \'b_sub_county\' matching \'Invalid Sub\'');
    });
  });

  describe('merge', () => {
    it('merge CHU: success', async () => {    
      const formData = {
        op: 'merge',
        source_replacement: 'c-h-u',
        source_SUBCOUNTY: 'from sub',
        destination_SUBCOUNTY: 'to sub',
        destination_replacement: 'destination',
      };
      const contactType = Config.getContactType('c_community_health_unit');
      const sessionCache = new SessionCache();
      
      const actual = await ManageHierarchyLib.scheduleJob(formData, contactType, sessionCache, chtApi(), chtConfQueue);
      expect(actual.sourceLineage.map((l:any) => l.id)).to.deep.eq(['from-chu-id', 'from-sub']);
      expect(actual.destinationLineage.map((l:any) => l.id)).to.deep.eq(['to-chu-id', 'to-sub']);

      // Verify the data passed to mockmoveContactQueue
      expect(chtConfQueue.add.calledOnce).to.be.true;
      const jobParams = chtConfQueue.add.getCall(0).args[0];

      expect(jobParams).to.have.property('jobName').that.equals('merge_[From Sub.c-h-u]_to_[To Sub.destination]');
      expect(jobParams).to.have.property('jobData').that.deep.include({
        action: 'merge',
        sourceId: 'from-chu-id',
        destinationId: 'to-chu-id',
        instanceUrl: 'http://domain.com',
        sessionToken: 'encoded-token',
      });
    });
  });

  describe('delete', () => {
    it('delete CHU: success', async () => {    
      const formData = {
        op: 'delete',
        source_replacement: 'c-h-u',
        source_SUBCOUNTY: 'from sub'
      };
      const contactType = Config.getContactType('c_community_health_unit');
      const sessionCache = new SessionCache();
      
      const actual = await ManageHierarchyLib.scheduleJob(formData, contactType, sessionCache, chtApi(), chtConfQueue);
      expect(actual.sourceLineage.map((l:any) => l.id)).to.deep.eq(['from-chu-id', 'from-sub']);
      expect(actual.destinationLineage.map((l:any) => l.id)).to.deep.eq([]);

      // Verify the data passed to mockmoveContactQueue
      expect(chtConfQueue.add.calledOnce).to.be.true;
      const jobParams = chtConfQueue.add.getCall(0).args[0];

      expect(jobParams).to.have.property('jobName').that.equals('delete_[From Sub.c-h-u]');
      expect(jobParams).to.have.property('jobData').that.deep.include({
        action: 'delete',
        sourceId: 'from-chu-id',
        instanceUrl: 'http://domain.com',
        sessionToken: 'encoded-token',
      });
    });
  });
});

