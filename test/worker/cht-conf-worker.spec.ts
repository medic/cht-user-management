import Chai from 'chai';
import Sinon from 'sinon';
import chaiAsPromised from 'chai-as-promised';
Chai.use(chaiAsPromised);

import Auth from '../../src/lib/authentication/authentication';
import { ChtConfWorker } from '../../src/worker/cht-conf-worker';
import { HierarchyAction } from '../../src/lib/manage-hierarchy';
import { mockChtSession } from '../mocks';

const { expect } = Chai;

const mockMonitoringResponse = (backlog) => ({ data: { sentinel: { backlog } } });
describe('worker/cht-conf-worker', () => {
  let executeStub;
  let monitoringStub;

  beforeEach(() => {
    executeStub = Sinon.stub().resolves(true);
    monitoringStub = Sinon.stub().resolves(mockMonitoringResponse(10));
    ChtConfWorker.fetchMonitoringApi = monitoringStub;
    ChtConfWorker.executeCommand = executeStub;

    const now = new Date('1-1-2000');
    Sinon.useFakeTimers(now);
  });

  afterEach(() => {
    Sinon.restore();
  });

  describe('handleJob', () => {
    it('move contacts', async () => {
      const job = mockJob('move');
      await ChtConfWorker.handleJob(job);

      expect(executeStub.calledOnce).to.be.true;
      expect(executeStub.args[0][1]).to.deep.eq([
        '--url=https://hostname',
        '--session-token=session-token',
        '--force',
        'move-contacts',
        'upload-docs',
        '--',
        '--contacts=sourceId',
        '--parent=destinationId',
      ]);
    });

    it('merge contacts', async () => {
      const job = mockJob('merge');
      await ChtConfWorker.handleJob(job);

      expect(executeStub.calledOnce).to.be.true;
      expect(executeStub.args[0][1]).to.deep.eq([
        '--url=https://hostname',
        '--session-token=session-token',
        '--force',
        'merge-contacts',
        'upload-docs',
        '--',
        '--sources=sourceId',
        '--destination=destinationId',
        '--merge-primary-contacts',
        '--disable-users',
      ]);
    });

    it('delete contacts', async () => {
      const job = mockJob('delete');
      await ChtConfWorker.handleJob(job);

      expect(executeStub.calledOnce).to.be.true;
      expect(executeStub.args[0][1]).to.deep.eq([
        '--url=https://hostname',
        '--session-token=session-token',
        '--force',
        'delete-contacts',
        'upload-docs',
        '--',
        '--contacts=sourceId',
        '--disable-users',
      ]);
    });

    it('log and throw when execution fails', async () => {
      executeStub.rejects('failure');
      const job = mockJob('delete');
      const actual = ChtConfWorker.handleJob(job);
      await expect(actual).to.eventually.be.rejectedWith('following error: failure');

      expect(job.log.calledOnce).to.be.true;
      expect(job.log.args[0][0]).to.include('following error: failure');
    });

    it('sentinel backlog causes postpone', async () => {
      monitoringStub.resolves(mockMonitoringResponse(10000));
      const job = mockJob('move');
      const actual = ChtConfWorker.handleJob(job);
      await expect(actual).to.eventually.be.rejectedWith();
      expect(executeStub.callCount).to.eq(0);

      expect(job.log.calledOnce).to.be.true;
      expect(job.log.args[0][0]).to.include('backlog too high');
      expect(job.log.args[0][0]).to.include('until 4:00 AM');
    });
  });
});

function mockJob(action: HierarchyAction) {
  const session = mockChtSession();

  return {
    log: Sinon.stub(),
    moveToDelayed: Sinon.stub(),
    data: {
      sourceId: 'sourceId',
      destinationId: 'destinationId',
      action,
      sessionToken: Auth.encodeTokenForWorker(session),
      instanceUrl: 'https://hostname'
    }
  };
}

