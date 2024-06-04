import { expect } from 'chai';
import sinon from 'sinon';
import { Queue } from 'bullmq';
import { BullMQQueueManager, JobParams } from '../../src/shared/queues';

describe('BullMQQueueManager', () => {
  let queueManager: BullMQQueueManager;
  let addStub: sinon.SinonStub;
  let getOrCreateQueueStub: sinon.SinonStub;
  let mockQueue: sinon.SinonStubbedInstance<Queue>;

  beforeEach(() => {
    queueManager = new BullMQQueueManager();
    mockQueue = sinon.createStubInstance(Queue);
    addStub = mockQueue.add.resolves();
    getOrCreateQueueStub = sinon.stub(queueManager as any, 'getOrCreateQueue').returns(
      mockQueue as unknown as Queue
    );
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

    await queueManager.addJob(jobParams);

    expect(addStub.calledOnce).to.be.true;
    expect(addStub.calledOnceWithExactly(
      jobParams.jobName, 
      jobParams.jobData,
      { jobId: sinon.match.string }
    )).to.be.true;
  });

  it('should create a new queue if it does not exist', async () => {
    const jobParams: JobParams = {
      jobName: 'testJob',
      jobData: { key: 'value' },
      jobOpts: {}
    };

    await queueManager.addJob(jobParams);
    const queue = queueManager.getQueue();

    expect(queue).to.equal(mockQueue);

    // Ensure getOrCreateQueue was called twice (once by addJob and once by getQueue)
    expect(getOrCreateQueueStub.callCount).to.equal(2);
  });

  it('should add multiple jobs to the same queue', async () => {
    const getQueueSpy = sinon.spy(queueManager, 'getQueue');
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

    await queueManager.addJob(jobParams1);
    await queueManager.addJob(jobParams2);

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

    // Ensure that getQueue was called twice with the same queue name
    expect(getQueueSpy.calledTwice).to.be.true;

    // Check if the same queue instance is used for both jobs
    const firstQueueInstance = getQueueSpy.firstCall.returnValue;
    const secondQueueInstance = getQueueSpy.secondCall.returnValue;
    expect(firstQueueInstance).to.equal(secondQueueInstance);
  });

  it('should return an existing queue if it already exists', async () => {
    const queueName = 'MOVE_CONTACT_QUEUE';
    const jobParams: JobParams = {
      jobName: 'testJob',
      jobData: { key: 'value' },
      jobOpts: {}
    };

    await queueManager.addJob(jobParams);
    const firstQueue = queueManager.getQueue();

    const secondQueue = queueManager.getQueue();
    expect(firstQueue).to.equal(secondQueue);

    /// Ensure getOrCreateQueue was called twice (once by addJob and once by each getQueue)
    expect(getOrCreateQueueStub.callCount).to.equal(3);
    // Ensure getOrCreateQueue was called with the correct arguments
    expect(getOrCreateQueueStub.firstCall.calledWithExactly(queueName)).to.be.true;
  });
});
