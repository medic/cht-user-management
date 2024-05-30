/* eslint-disable dot-notation */
import { expect } from 'chai';
import sinon, { SinonSandbox } from 'sinon';
import { MoveContactWorker, MoveContactData, JobResult } from '../../src/worker/move-contact-worker';
import Auth from '../../src/lib/authentication';
import axios from 'axios';
import { queueManager } from '../../src/shared/queues';

describe('MoveContactWorker', () => {
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
    data: jobData,
    log: sinon.stub(),
    opts: {},
    name: 'testJob'
  };

  let canProcessStub: sinon.SinonStub;
  let moveContactStub: sinon.SinonStub;
  let postponeStub: sinon.SinonStub;
  let decodeTokenStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    worker = new MoveContactWorker(queueName);
    canProcessStub = sandbox.stub(worker as any, 'canProcess');
    moveContactStub = sandbox.stub(worker as any, 'moveContact');
    postponeStub = sandbox.stub(worker as any, 'postpone');
    decodeTokenStub = sandbox.stub(Auth, 'decodeToken');
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('handleJob', () => {
    it('should handle job successfully', async () => {
      canProcessStub.resolves(true);
      moveContactStub.resolves({ success: true, message: '' });

      const result = await (worker as any)['handleJob'](job);
      expect(result).to.be.true;
    });

    it('should postpone job if cannot process', async () => {
      canProcessStub.resolves(false);
      postponeStub.resolves(true);

      const result = await (worker as any)['handleJob'](job);
      expect(result).to.be.true;
      expect(postponeStub.calledWith(job)).to.be.true;
    });

    it('should log error and throw if moveContact fails', async () => {
      canProcessStub.resolves(true);
      moveContactStub.resolves({ success: false, message: 'error' });

      try {
        await (worker as any)['handleJob'](job);
      } catch (e) {
        expect(e.message).to.equal('Job job123 failed with the following error: error');
      }
    });
  });

  describe('canProcess', () => {
    it('should return true if sentinel backlog is within limit', async () => {
      canProcessStub.callThrough();
      sandbox.stub(axios, 'get').resolves({ data: { sentinel: { backlog: 500 } } });

      const result = await (worker as any)['canProcess'](jobData);
      expect(result).to.be.true;
    });

    it('should return false if sentinel backlog exceeds limit', async () => {
      canProcessStub.callThrough();
      sandbox.stub(axios, 'get').resolves({ data: { sentinel: { backlog: 1500 } } });

      const result = await (worker as any)['canProcess'](jobData);
      expect(result).to.be.false;
    });

    it('should return false if axios request fails', async () => {
      canProcessStub.callThrough();
      sandbox.stub(axios, 'get').rejects(new Error('network error'));

      const result = await (worker as any)['canProcess'](jobData);
      expect(result).to.be.false;
    });
  });

  describe('moveContact', () => {

    it('should return error if sessionToken is missing', async () => {
      moveContactStub.callThrough();
      const result: JobResult = await (worker as any)['moveContact']({ ...jobData, sessionToken: '' });
      expect(result.success).to.be.false;
      expect(result.message).to.equal('Missing session token');
    });

    it('should return error if queuePrivateKey is missing', async () => {
      moveContactStub.callThrough();
      decodeTokenStub.throws(new Error('Missing QUEUE_PRIVATE_KEY'));

      const result: JobResult = await (worker as any)['moveContact'](jobData);
      expect(result.success).to.be.false;
      expect(result.message).to.match(/Missing QUEUE_PRIVATE_KEY/);
    });
  });

  describe('postpone', () => {
    it('should add job back to queue with delay', async () => {
      postponeStub.callThrough();
      sandbox.stub(queueManager, 'addJob').resolves();

      const result = await (worker as any)['postpone'](job);
      expect(result).to.be.true;
    });
  });
});

