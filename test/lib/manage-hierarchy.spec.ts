import Chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { DateTime } from 'luxon';
import sinon from 'sinon';

import Auth from '../../src/lib/authentication';
import { Config } from '../../src/config';
import { JobParams } from '../../src/lib/queues';
import ManageHierarchyLib from '../../src/lib/manage-hierarchy';
import { mockChtApi, mockChtSession } from '../mocks';
import RemotePlaceCache from '../../src/lib/remote-place-cache';
import SessionCache from '../../src/services/session-cache';

Chai.use(chaiAsPromised);

const { expect } = Chai;

describe('lib/manage-hierarchy.ts', () => {
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
      const contactType = await Config.getContactType('c_community_health_unit');
      const sessionCache = new SessionCache();
      
      const jobParams = await ManageHierarchyLib.getJobDetails(formData, contactType, sessionCache, chtApiWithDocs());
      expect(jobParams).to.have.property('jobName').that.equals('move_[From Sub.C-H-U]_to_[To Sub]');
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
      const contactType = await Config.getContactType('c_community_health_unit');
      const sessionCache = new SessionCache();

      const actual = ManageHierarchyLib.getJobDetails(formData, contactType, sessionCache, mockChtApi([], chuDocs));
      await expect(actual).to.eventually.be.rejectedWith('search string is empty');
    });

    it('move CHU: cant move to same place', async () => {
      const formData = {
        op: 'move',
        source_replacement: 'c-h-u',
        source_SUBCOUNTY: 'from SUB',
        destination_SUBCOUNTY: 'from sub',
      };
      const contactType = await Config.getContactType('c_community_health_unit');
      const sessionCache = new SessionCache();

      const actual = ManageHierarchyLib.getJobDetails(formData, contactType, sessionCache, chtApiWithDocs());
      await expect(actual).to.eventually.be.rejectedWith('Place "c-h-u" already has "From Sub" as parent');
    });

    it('move CHU: fail to resolve parent', async () => {
      const formData = {
        op: 'move',
        source_replacement: 'c-h-u',
        source_SUBCOUNTY: 'from SUB',
        destination_SUBCOUNTY: 'invalid sub',
      };
      const contactType = await Config.getContactType('c_community_health_unit');
      const sessionCache = new SessionCache();

      const actual = ManageHierarchyLib.getJobDetails(formData, contactType, sessionCache, chtApiWithDocs());
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
      const contactType = await Config.getContactType('c_community_health_unit');
      const sessionCache = new SessionCache();
      
      const jobParams = await ManageHierarchyLib.getJobDetails(formData, contactType, sessionCache, chtApiWithDocs());
      expect(jobParams).to.have.property('jobName').that.equals('merge_[From Sub.C-H-U]_to_[To Sub.Destination]');
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
      const contactType = await Config.getContactType('c_community_health_unit');
      const sessionCache = new SessionCache();
      
      const jobParams = await ManageHierarchyLib.getJobDetails(formData, contactType, sessionCache, chtApiWithDocs());
      expect(jobParams).to.have.property('jobName').that.equals('delete_[From Sub.C-H-U]');
      expect(jobParams).to.have.property('jobData').that.deep.include({
        action: 'delete',
        sourceId: 'from-chu-id',
        instanceUrl: 'http://domain.com',
        sessionToken: 'encoded-token',
      });
    });
  });

  describe('getWarningInfo', () => {
    let clock;

    // Mocking the system clock to set the current date to June 15, 2024 (quite middle).
    // This ensures consistent test behavior for relative date calculations.
    // Related issue: https://github.com/medic/cht-user-management/issues/238
    beforeEach(() => {
      const fixedDate = DateTime.local(2024, 6, 15).toJSDate();
      clock = sinon.useFakeTimers(fixedDate.getTime());
    });
  
    afterEach(() => {
      // Restore the original system clock behavior after tests.
      clock.restore();
    });
  

    const fakeJob: JobParams = { jobName: 'foo', jobData: { sourceId: 'abc' }};

    it('below thresholds', async () => {
      const chtApi = mockChtApi();
      chtApi.countContactsUnderPlace = sinon.stub().resolves(5);
      chtApi.lastSyncAtPlace = sinon.stub().resolves(DateTime.now().minus({ days: 100 }));
      const actual = await ManageHierarchyLib.getWarningInfo(fakeJob, chtApi);
      expect(actual).to.deep.eq({
        affectedPlaceCount: 5,
        lastSyncDescription: '3 months ago',
        userIsActive: false,
        lotsOfPlaces: false,
      });
    });

    it('above thresholds', async () => {
      const chtApi = mockChtApi();
      chtApi.countContactsUnderPlace = sinon.stub().resolves(1000);
      chtApi.lastSyncAtPlace = sinon.stub().resolves(DateTime.now().minus({ days: 10 }));
      const actual = await ManageHierarchyLib.getWarningInfo(fakeJob, chtApi);
      expect(actual).to.deep.eq({
        affectedPlaceCount: 1000,
        lastSyncDescription: '10 days ago',
        userIsActive: true,
        lotsOfPlaces: true,
      });
    });

    it('no sync details for non-admins', async () => {
      const chtApi = mockChtApi();
      chtApi.chtSession = mockChtSession('abc');
      chtApi.countContactsUnderPlace = sinon.stub().resolves(2);
      chtApi.lastSyncAtPlace = sinon.stub().throws('only for admins');
      const actual = await ManageHierarchyLib.getWarningInfo(fakeJob, chtApi);
      expect(actual).to.deep.eq({
        affectedPlaceCount: 2,
        lastSyncDescription: '-',
        userIsActive: false,
        lotsOfPlaces: false,
      });
      expect(chtApi.lastSyncAtPlace.called).to.be.false;
    });

    it('very old sync dates show as -', async () => {
      const chtApi = mockChtApi();
      chtApi.countContactsUnderPlace = sinon.stub().resolves(2);
      chtApi.lastSyncAtPlace = sinon.stub().resolves(DateTime.now().minus({ days: 1000 }));
      const actual = await ManageHierarchyLib.getWarningInfo(fakeJob, chtApi);
      expect(actual).to.deep.include({
        lastSyncDescription: 'over a year',
        userIsActive: false,
      });
    });

    it('sync dates in future show as -', async () => {
      const chtApi = mockChtApi();
      chtApi.countContactsUnderPlace = sinon.stub().resolves(2);
      chtApi.lastSyncAtPlace = sinon.stub().resolves(DateTime.now().plus({ days: 1 }));
      const actual = await ManageHierarchyLib.getWarningInfo(fakeJob, chtApi);
      expect(actual).to.deep.include({
        lastSyncDescription: '-',
        userIsActive: false,
      });
    });
  });
});

