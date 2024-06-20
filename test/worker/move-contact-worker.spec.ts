/* eslint-disable dot-notation */
import axios from 'axios';
import { expect } from 'chai';
import sinon, { SinonSandbox } from 'sinon';

import Auth from '../../src/lib/authentication';
import { moveContactQueue } from '../../src/lib/queues';
import { 
  MoveContactWorker, 
  MoveContactData, 
  JobResult 
} from '../../src/worker/move-contact-worker';

describe('worker/move-contact-worker', () => {
  let worker: MoveContactWorker;
  let sandbox: SinonSandbox;
  const queueName = 'testQueue';
  const jobData: MoveContactData = {
    parentId: 'parent123',
    contactId: 'contact123',
    sessionToken: 'token123',
    instanceUrl: 'http://test-instance.com'
  };
  const job = {
    id: 'job123',
    name: 'testJob',
    data: jobData,
    opts: {},
    log: sinon.stub(),
    moveToDelayed: sinon.stub(),
  };

  let shouldPostponeStub: sinon.SinonStub;
  let moveContactStub: sinon.SinonStub;
  let postponeStub: sinon.SinonStub;
  let decodeTokenStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    sandbox.stub(MoveContactWorker.prototype as any, 'initializeWorker').callsFake(() => {});
    sandbox.stub(moveContactQueue, 'add').resolves();

    worker = new MoveContactWorker(queueName);
    shouldPostponeStub = sandbox.stub(worker as any, 'shouldPostpone');
    moveContactStub = sandbox.stub(worker as any, 'moveContact');
    postponeStub = sandbox.stub(worker as any, 'postpone');
    decodeTokenStub = sandbox.stub(Auth, 'decodeTokenForQueue');
    
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('handleJob', () => {
    it('should handle job successfully', async () => {
      shouldPostponeStub.resolves(false);
      moveContactStub.resolves({ success: true, message: '' });

      const result = await (worker as any)['handleJob'](job);
      expect(result).to.be.true;
    });

    it('should postpone job if cannot process', async () => {
      shouldPostponeStub.resolves(true);
      postponeStub.resolves();

      expect( (worker as any)['handleJob'](job) ).to.rejected;
    });

    it('should log error and throw if moveContact fails', async () => {
      shouldPostponeStub.resolves(false);
      moveContactStub.resolves({ success: false, message: 'error' });

      expect( (worker as any)['handleJob'](job) ).to.rejected;
    });
  });

  describe('shouldPostpone', () => {
    it('should return false if sentinel backlog is within limit', async () => {
      shouldPostponeStub.callThrough();
      sandbox.stub(axios, 'get').resolves({ data: { sentinel: { backlog: 500 } } });

      const result = await (worker as any)['shouldPostpone'](jobData);
      expect(result).to.be.false;
    });

    it('should return true if sentinel backlog exceeds limit', async () => {
      shouldPostponeStub.callThrough();
      sandbox.stub(axios, 'get').resolves({ data: { sentinel: { backlog: 10000 } } });

      const result = await (worker as any)['shouldPostpone'](jobData);
      expect(result).to.be.true;
    });

    it('should return true if axios request fails', async () => {
      shouldPostponeStub.callThrough();
      sandbox.stub(axios, 'get').rejects(new Error('network error'));

      const result = await (worker as any)['shouldPostpone'](jobData);
      expect(result).to.be.true;
    });
  });

  describe('moveContact', () => {

    it('should return error if sessionToken is missing', async () => {
      moveContactStub.callThrough();
      const result: JobResult = await (worker as any)['moveContact']({ ...jobData, sessionToken: '' });
      expect(result.success).to.be.false;
      expect(result.message).to.equal('Missing session token');
    });

    it('should return error if QUEUE_PRIVATE_KEY is missing', async () => {
      moveContactStub.callThrough();
      decodeTokenStub.throws(new Error('Missing QUEUE_PRIVATE_KEY'));

      const result: JobResult = await (worker as any)['moveContact'](jobData);
      expect(result.success).to.be.false;
      expect(result.message).to.match(/Missing QUEUE_PRIVATE_KEY/);
    });
  });

  describe('postpone', () => {
    it('should move the job to a delayed state', async () => {
      postponeStub.callThrough();

      await (worker as any)['postpone'](job);
      expect(job.moveToDelayed.calledOnce).to.be.true;
    });
  });
});
