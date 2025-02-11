/* eslint-disable dot-notation */
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { Job} from 'bullmq';
import sinon from 'sinon';

import MoveLib from '../../src/lib/manage-hierarchy';

import Auth from '../../src/lib/authentication/authentication';
import { Config } from '../../src/config';
import { BullQueue } from '../../src/lib/queues';
import { mockChtApi, mockChtSession } from '../mocks';
import { ChtConfWorker } from '../../src/worker/cht-conf-worker';
import SessionCache from '../../src/services/session-cache';

const { expect } = chai;
chai.use(chaiAsPromised);

describe('integration/manage-hierarchy',  function () {

  const queueName = 'move_contact_queue';
  const connection = { host: '127.0.0.1', port: 6363 };
  const defaultJobOptions = { attempts: 3, backoff: { type: 'custom' } };

  let sandbox: sinon.SinonSandbox;
  let addStub: sinon.SinonStub;
  let handleJobStub: sinon.SinonStub;
  let shouldPostponeStub: sinon.SinonStub;
  let executeCommandStub: sinon.SinonStub;
  let encodeTokenStub: sinon.SinonStub;
  let decodeTokenStub: sinon.SinonStub;
  let moveContactQueue: BullQueue;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    moveContactQueue = new BullQueue(queueName, connection, defaultJobOptions);
    addStub = sandbox.stub(moveContactQueue, 'add');

    handleJobStub = sandbox.stub(ChtConfWorker as any, 'handleJob');
    shouldPostponeStub = sandbox.stub(ChtConfWorker as any, 'shouldPostpone');
    executeCommandStub = sandbox.stub(ChtConfWorker as any, 'executeCommand');

    encodeTokenStub = sandbox.stub(Auth, 'encodeTokenForWorker');
    decodeTokenStub = sandbox.stub(Auth, 'createWorkerSession');

    ChtConfWorker.processQueue(queueName, connection);
  });

  afterEach(async () => {
    await ChtConfWorker.close();
    await moveContactQueue.close();
    sandbox.restore();
  });

  const formData = {
    from_replacement: 'c-h-u',
    from_SUBCOUNTY: 'from sub',
    to_SUBCOUNTY: 'to sub',
  };
  const contactType = Config.getContactType('c_community_health_unit');
  const session = mockChtSession();
  const sessionCache = SessionCache.getForSession(session);
  const chtApi = () => mockChtApi(
    [
      { id: 'from-sub', name: 'From Sub', lineage: [], type: 'remote' },
      { id: 'to-sub', name: 'To Sub', lineage: [], type: 'remote' }
    ],
    [{ id: 'chu-id', name: 'c-h-u', lineage: ['from-sub'], type: 'remote' }],
  );

  it('should process a move contact job', async () => {
    addStub.callThrough();
    handleJobStub.callThrough();
    shouldPostponeStub.resolves(false);

    encodeTokenStub.returns('encoded-token');
    decodeTokenStub.returns(session);

    await MoveLib.scheduleJob(
      formData, contactType, sessionCache, chtApi(), moveContactQueue
    );

    expect(addStub.calledOnce).to.be.true;
    const jobParams = addStub.getCall(0).args[0];
    expect(jobParams).to.have.property('jobName').that.includes('move_');
    expect(jobParams).to.have.property('jobData').that.includes(
      { contactId: 'chu-id', parentId: 'to-sub', sessionToken: 'encoded-token' }
    );

    await new Promise(resolve => setTimeout(resolve, 1000));

    expect(executeCommandStub.calledOnce).to.be.true;

    expect(executeCommandStub.calledOnce).to.be.true;
    const [command, args] = executeCommandStub.firstCall.args;
    expect(command).to.equal('cht');
    expect(args).to.include('--url=http://domain.com');
    expect(args).to.include('--session-token=session-token');
    expect(args).to.include('move-contacts');
  });

  it('should fail with incorrect session token', async () => {
    addStub.callThrough();
    handleJobStub.callThrough();
    shouldPostponeStub.resolves(false);

    encodeTokenStub.returns('encoded-token');
    decodeTokenStub.throws(new Error('Missing WORKER_PRIVATE_KEY'));

    await MoveLib.scheduleJob(
      formData, contactType, sessionCache, chtApi(), moveContactQueue
    );

    expect(addStub.calledOnce).to.be.true;
    const jobId = await addStub.getCall(0).returnValue;
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Check if the job has failed
    const job = await moveContactQueue['bullQueue'].getJob(jobId) as unknown as Job;
    expect(await job.getState()).to.equal('failed');
  });
});
