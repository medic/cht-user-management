import { AxiosError } from 'axios';
import isRetryAllowed from 'is-retry-allowed';

const axiosRetryConfig = {
  retries: 5,
  retryDelay: () => 1000,
  retryCondition: isRetryAllowed,
  onRetry: (retryCount: number, error: AxiosError) => {
    console.log(`${retryCount} retry for ${error.request.url}`);
  },
};

export default axiosRetryConfig;