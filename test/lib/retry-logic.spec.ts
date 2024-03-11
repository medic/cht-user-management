import Chai from 'chai';
import sinon from 'sinon';

import * as RetryLogic from '../../src/lib/retry-logic';
import { UserPayload } from '../../src/services/user-payload';
import { ChtApi } from '../../src/lib/cht-api';
import { mockSimpleContactType } from '../mocks';

import chaiAsPromised from 'chai-as-promised';
import Place from '../../src/services/place';
Chai.use(chaiAsPromised);

const { expect } = Chai;

const RetryScenarios = [
  { desc: '503', axiosError: { response: { status: 503 } }, retry: 'axios' },
  { desc: 'axios timeout', axiosError: { code: 'ECONNABORTED' }, retry: 'axios' },
  { desc: 'service timeout', axiosError: { code: 'ECONNRESET' }, retry: 'axios' },

  { desc: 'update conflict', axiosError: { code: 'ERR_BAD_REQUEST', response: { status: 409 } }, retry: 'update-conflict' },
  
  {
    desc: 'username taken is not retried', 
    axiosError: { 
      code: 'ERR_BAD_REQUEST', 
      response: {
        status: 400,
        data: { error: { message: 'Username "chu" already taken.', translationKey: 'username.taken' } },
      } 
    },
    retry: 'upload-manager'
  },
  {
    desc: 'password too short', 
    axiosError: { 
      code: 'ERR_BAD_REQUEST', 
      response: {
        status: 400,
        data: { error: { message: 'The password must be at least 8 characters long.', translationKey: 'password.length.minimum' } },
      } 
    },
    retry: 'upload-manager'
  },
  {
    desc: 'password too weak (json)', 
    axiosError: { 
      code: 'ERR_BAD_REQUEST', 
      response: {
        status: 400,
        data: {
          error: {
            message: 'The password is too easy to guess. Include a range of types of characters to increase the score.',
            translationKey: 'password.weak'
          }
        },
      } 
    },
    retry: 'upload-manager'
  },
  {
    desc: 'password too weak (string)', 
    axiosError: { 
      code: 'ERR_BAD_REQUEST', 
      response: {
        status: 400,
        data: 'The password is too easy to guess. Include a range of types of characters to increase the score.',
      } 
    },
    retry: 'upload-manager'
  },
];

export const UploadManagerRetryScenario = RetryScenarios[RetryScenarios.length - 1];
const UpdateConflictScenario = RetryScenarios.find(s => s.retry === 'update-conflict');

describe('lib/retry-logic', () => {
  describe('axiosRetryConfig', () => {
    for (const scenario of RetryScenarios) {
      it(scenario.desc, () => {
        const doRetry = RetryLogic.axiosRetryConfig.retryCondition(scenario.axiosError as any);
        expect(doRetry).to.eq(scenario.retry === 'axios');
      });
    }
  });

  describe('retryOnUpdateConflict', () => {
    for (const scenario of RetryScenarios) {
      it(scenario.desc, async () => {
        const output = 'foo';
        const testFunction = sinon.stub()
          .rejects(scenario.axiosError)
          .onSecondCall().resolves(output);
        const execute = RetryLogic.retryOnUpdateConflict<string>(testFunction);
        const expectRetry = scenario.retry === 'update-conflict';
        if (expectRetry) {
          await expect(execute).to.eventually.eq(output);
          expect(testFunction.callCount).to.eq(expectRetry ? 2 : 1);
        } else {
          await expect(execute).to.eventually.be.rejectedWith(scenario.axiosError);
        }
      });
    }

    it('throws after persistent conflict', async () => {
      const testFunction = sinon.stub().rejects(UpdateConflictScenario?.axiosError);
      const execute = RetryLogic.retryOnUpdateConflict<string>(testFunction);
      await expect(execute).to.eventually.be.rejectedWith('persisted');
      expect(testFunction.callCount).to.eq(4);
    });
  });

  describe('createUserWithRetries', () => {
    for (const scenario of RetryScenarios) {
      it(scenario.desc, async() => {
        const chtApi = {
          createUser: sinon.stub().throws(scenario.axiosError),
        };
        const place = {
          generateUsername: sinon.stub().returns('username'),
          extractUserRoles: sinon.stub().returns([]),
          type: mockSimpleContactType('string', 'bar'),
          contact: { properties: {} },
        };
        const userPayload = new UserPayload(place as Place, 'place_id', 'contact_id');
    
        const execute = RetryLogic.createUserWithRetries(userPayload as UserPayload, chtApi as ChtApi);
        const expectRetry = ['upload-manager', 'axios'].includes(scenario.retry);
        if (expectRetry) {
          await expect(execute).to.eventually.be.rejectedWith('could not create user');
          expect(chtApi.createUser.callCount).to.eq(4);
        } else {
          await expect(execute).to.eventually.be.rejectedWith(scenario.axiosError);
          expect(chtApi.createUser.callCount).to.eq(1);
        }
      });
    }
  });
});
