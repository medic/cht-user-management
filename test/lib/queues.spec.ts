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
