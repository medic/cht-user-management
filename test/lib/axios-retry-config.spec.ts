import { expect } from 'chai';
import AxiosRetryConfig from '../../src/lib/axios-retry-config';
import { UploadManagerRetryScenarios } from '../services/upload-manager.spec';

const scenarios = [
  { desc: '503', axiosError: { response: { status: 503 } } },
  { desc: 'axios timeout', axiosError: { code: 'ECONNABORTED' } },
  { desc: 'service timeout', axiosError: { code: 'ECONNRESET' } },
  { desc: 'update conflict', axiosError: { code: 'ERR_BAD_REQUEST', response: { status: 409 } } },
];

describe('lib/axios-retry-config', () => {
  for (const scenario of scenarios) {
    it(scenario.desc, () => {
      const doRetry = AxiosRetryConfig.retryCondition(scenario.axiosError as any);
      expect(doRetry).to.eq(true);
    });
  }

  for (const scenario of UploadManagerRetryScenarios) {
    it(scenario.desc, () => {
      const doRetry = AxiosRetryConfig.retryCondition(scenario.axiosError as any);
      expect(doRetry).to.eq(false);
    });
  }
});
