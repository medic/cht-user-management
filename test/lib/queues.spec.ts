import { expect } from 'chai';
import sinon from 'sinon';
import { Queue } from 'bullmq';
import { BullQueue, JobParams } from '../../src/lib/queues';

describe('lib/queues.ts', () => {
  let moveContactQueue: BullQueue;
  let addStub: sinon.SinonStub;
  let mockQueue: sinon.SinonStubbedInstance<Queue>;

  beforeEach(() => {
    moveContactQueue = new BullQueue('testQueue', { enableOfflineQueue: false });
    mockQueue = sinon.createStubInstance(Queue);
    addStub = mockQueue.add.resolves();
    sinon.stub(moveContactQueue, 'bullQueue').value(mockQueue);
  });

  afterEach(() => {
    sinon.restore();
    moveContactQueue.bullQueue.close();
  });

  it('should add a job to the queue', async () => {
    const jobParams: JobParams = {
      jobName: 'testJob',
      jobData: { key: 'value' },
      jobOpts: {}
    };

    await moveContactQueue.add(jobParams);

    expect(addStub.calledOnce).to.be.true;
    expect(addStub.calledOnceWithExactly(
      jobParams.jobName, 
      jobParams.jobData,
      { jobId: sinon.match.string }
    )).to.be.true;
  });

  it('should return the correct queue name', () => {
    expect(moveContactQueue.name).to.equal('testQueue');
  });

  describe('cancel', () => {
    it('returns "cancelled" and calls job.remove when the job exists', async () => {
      const removeStub = sinon.stub().resolves();
      mockQueue.getJob.resolves({ remove: removeStub } as any);

      const result = await moveContactQueue.cancel('job-id-1');

      expect(result).to.equal('cancelled');
      expect(mockQueue.getJob.calledOnceWithExactly('job-id-1')).to.be.true;
      expect(removeStub.calledOnce).to.be.true;
    });

    it('returns "not_found" when getJob resolves undefined', async () => {
      mockQueue.getJob.resolves(undefined);

      const result = await moveContactQueue.cancel('missing');

      expect(result).to.equal('not_found');
    });

    it('returns "locked" when remove rejects with a "locked" message', async () => {
      const removeStub = sinon.stub().rejects(new Error('Job job-id-2 is locked'));
      mockQueue.getJob.resolves({ remove: removeStub } as any);

      const result = await moveContactQueue.cancel('job-id-2');

      expect(result).to.equal('locked');
    });

    it('rethrows any non-locked remove error', async () => {
      const removeStub = sinon.stub().rejects(new Error('redis connection lost'));
      mockQueue.getJob.resolves({ remove: removeStub } as any);

      let caught: Error | null = null;
      try {
        await moveContactQueue.cancel('job-id-3');
      } catch (e) {
        caught = e as Error;
      }

      expect(caught?.message).to.equal('redis connection lost');
    });
  });

  it('should add multiple jobs to the same queue', async () => {
    const jobParams1: JobParams = {
      jobName: 'testJob1',
      jobData: { key: 'value1' },
      jobOpts: {}
    };
    const jobParams2: JobParams = {
      jobName: 'testJob2',
      jobData: { key: 'value2' },
      jobOpts: {}
    };

    await moveContactQueue.add(jobParams1);
    await moveContactQueue.add(jobParams2);

    expect(addStub.calledTwice).to.be.true;
    expect(addStub.firstCall.calledWith(
      jobParams1.jobName, 
      jobParams1.jobData,
      { jobId: sinon.match.string }
    )).to.be.true;
    expect(addStub.secondCall.calledWith(
      jobParams2.jobName, 
      jobParams2.jobData,
      { jobId: sinon.match.string }
    )).to.be.true;
  });
});
