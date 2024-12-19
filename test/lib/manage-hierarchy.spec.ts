import Chai from 'chai';
import sinon from 'sinon';

import ManageHierarchyLib from '../../src/lib/manage-hierarchy';
import { Config } from '../../src/config';
import SessionCache from '../../src/services/session-cache';
import { mockChtApi } from '../mocks';

import chaiAsPromised from 'chai-as-promised';
import Auth from '../../src/lib/authentication';
import { BullQueue } from '../../src/lib/queues';
import RemotePlaceCache from '../../src/lib/remote-place-cache';
Chai.use(chaiAsPromised);

const { expect } = Chai;

describe('lib/manage-hierarchy.ts', () => {
  let chtConfQueue: any;

  const subcountyDocs = [
    { _id: 'from-sub', name: 'From Sub' },
    { _id: 'to-sub', name: 'To Sub' }
  ];
  const chuDocs = [
    { _id: 'from-chu-id', name: 'c-h-u', parent: { _id: 'from-sub' } },
    { _id: 'to-chu-id', name: 'destination', parent: { _id: 'to-sub' } },
  ];

  const chtApiWithDocs = () => mockChtApi(subcountyDocs, chuDocs);

  beforeEach(() => {
    chtConfQueue = sinon.createStubInstance(BullQueue);
    sinon.stub(Auth, 'encodeTokenForWorker').returns('encoded-token');
    RemotePlaceCache.clear({});
  });

  afterEach(() => {
    sinon.restore();
  });

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
      
      const actual = await ManageHierarchyLib.scheduleJob(formData, contactType, sessionCache, chtApiWithDocs(), chtConfQueue);
      expect(actual.sourceLineage.map((l:any) => l.id)).to.deep.eq(['from-chu-id', 'from-sub']);
      expect(actual.destinationLineage.map((l:any) => l.id)).to.deep.eq([undefined, 'to-sub']);

      // Verify the data passed to mockmoveContactQueue
      expect(chtConfQueue.add.calledOnce).to.be.true;
      const jobParams = chtConfQueue.add.getCall(0).args[0];

      expect(jobParams).to.have.property('jobName').that.equals('move_[From Sub.C-h-u]_to_[To Sub]');
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

      const actual = ManageHierarchyLib.scheduleJob(formData, contactType, sessionCache, mockChtApi(chuDocs), chtConfQueue);
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

      const actual = ManageHierarchyLib.scheduleJob(formData, contactType, sessionCache, chtApiWithDocs(), chtConfQueue);
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

      const actual = ManageHierarchyLib.scheduleJob(formData, contactType, sessionCache, chtApiWithDocs(), chtConfQueue);
      await expect(actual).to.eventually.be.rejectedWith('Cannot find \'b_sub_county\' matching \'invalid sub\'');
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
      
      const actual = await ManageHierarchyLib.scheduleJob(formData, contactType, sessionCache, chtApiWithDocs(), chtConfQueue);
      expect(actual.sourceLineage.map((l:any) => l.id)).to.deep.eq(['from-chu-id', 'from-sub']);
      expect(actual.destinationLineage.map((l:any) => l.id)).to.deep.eq(['to-chu-id', 'to-sub']);

      // Verify the data passed to mockmoveContactQueue
      expect(chtConfQueue.add.calledOnce).to.be.true;
      const jobParams = chtConfQueue.add.getCall(0).args[0];

      expect(jobParams).to.have.property('jobName').that.equals('merge_[From Sub.C-h-u]_to_[To Sub.Destination]');
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
      
      const actual = await ManageHierarchyLib.scheduleJob(formData, contactType, sessionCache, chtApiWithDocs(), chtConfQueue);
      expect(actual.sourceLineage.map((l:any) => l.id)).to.deep.eq(['from-chu-id', 'from-sub']);
      expect(actual.destinationLineage.map((l:any) => l.id)).to.deep.eq([]);

      // Verify the data passed to mockmoveContactQueue
      expect(chtConfQueue.add.calledOnce).to.be.true;
      const jobParams = chtConfQueue.add.getCall(0).args[0];

      expect(jobParams).to.have.property('jobName').that.equals('delete_[From Sub.C-h-u]');
      expect(jobParams).to.have.property('jobData').that.deep.include({
        action: 'delete',
        sourceId: 'from-chu-id',
        instanceUrl: 'http://domain.com',
        sessionToken: 'encoded-token',
      });
    });
  });
});
