import { AxiosError, AxiosRequestConfig } from 'axios';
import isRetryAllowed from 'is-retry-allowed';

const axiosRetryConfig = {
  retries: 3,
  retryDelay: () => 1000,
  retryCondition: (err: AxiosError) => {
    const status = err.response?.status;
    return (!status || status === 409 || status >= 500) && isRetryAllowed(err);
  },
  onRetry: (retryCount: number, error: AxiosError, requestConfig: AxiosRequestConfig) => {
    console.log(`${requestConfig.url} failure. Retrying (${retryCount})`);
  },
};

export default axiosRetryConfig;
