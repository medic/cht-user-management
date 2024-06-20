import { expect } from 'chai';
import sinon from 'sinon';
import { Queue } from 'bullmq';
import { BullQueue, JobParams, moveContactQueue } from '../../src/lib/queues';

describe('lib/queues.ts', () => {
  let queueManager: BullQueue;
  let addStub: sinon.SinonStub;
  let mockQueue: sinon.SinonStubbedInstance<Queue>;

  beforeEach(() => {
    queueManager = new BullQueue('testQueue');
    mockQueue = sinon.createStubInstance(Queue);
    addStub = mockQueue.add.resolves();
    sinon.stub(queueManager, 'bullQueue').value(mockQueue);
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should add a job to the queue', async () => {
    const jobParams: JobParams = {
      jobName: 'testJob',
      jobData: { key: 'value' },
      jobOpts: {}
    };

    await queueManager.add(jobParams);

    expect(addStub.calledOnce).to.be.true;
    expect(addStub.calledOnceWithExactly(
      jobParams.jobName, 
      jobParams.jobData,
      { jobId: sinon.match.string }
    )).to.be.true;
  });

  it('should return the correct queue name', () => {
    expect(queueManager.name).to.equal('testQueue');
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

    await queueManager.add(jobParams1);
    await queueManager.add(jobParams2);

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

  it('should use the singleton instance correctly', async () => {
    const jobParams: JobParams = {
      jobName: 'singletonTestJob',
      jobData: { key: 'singletonValue' },
      jobOpts: {}
    };

    const singletonAddStub = sinon.stub(moveContactQueue.bullQueue, 'add').resolves();

    await moveContactQueue.add(jobParams);

    expect(singletonAddStub.calledOnce).to.be.true;
    expect(singletonAddStub.calledOnceWithExactly(
      jobParams.jobName, 
      jobParams.jobData,
      { jobId: sinon.match.string }
    )).to.be.true;

    singletonAddStub.restore();
  });
});
