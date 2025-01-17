import { AxiosError, AxiosRequestConfig } from 'axios';
import isRetryAllowed from 'is-retry-allowed';
import { UserPayload } from '../services/user-payload';
import { ChtApi } from './cht-api';

const RETRY_COUNT = 4;
const RETRYABLE_STATUS_CODES = [500, 502, 503, 504, 511];

export const axiosRetryConfig = {
  retries: RETRY_COUNT,
  retryDelay: () => 1000,
  retryCondition: (error: AxiosError) => {
    const status = error.response?.status;
    return (!status || RETRYABLE_STATUS_CODES.includes(status)) && isRetryAllowed(error);
  },
  onRetry: (retryCount: number, error: AxiosError, requestConfig: AxiosRequestConfig) => {
    console.log(`${requestConfig.url} failure (${error?.response?.status || '?'}). Retrying (${retryCount})`);
  },
};

export async function retryOnUpdateConflict<T>(funcWithGetAndPut: () => Promise<T>): Promise<T> {
  for (let retryCount = 0; retryCount < RETRY_COUNT; retryCount++) {
    try {
      return await funcWithGetAndPut();
    } catch (err : any) {
      const statusCode = err.response?.status;
      if (statusCode === 409) {
        console.log(`Retrying on update-conflict (${retryCount})`);
        continue;
      }
      
      throw err;
    }
  }

  throw Error('update-conflict 409 persisted');
}

export async function createUserWithRetries(userPayload: UserPayload, chtApi: ChtApi): Promise<{ username: string; password: string }> {
  for (let retryCount = 0; retryCount < RETRY_COUNT; ++retryCount) {
    try {
      await chtApi.createUser(userPayload);
      return userPayload;
    } catch (err: any) {      
      if (axiosRetryConfig.retryCondition(err)) {
        continue;
      }
      
      if (err.response?.status !== 400) {
        throw err;
      }

      // no idea when/why some instances yield "response.data" as JSON vs some as string
      const errorMessage = err.response?.data?.error?.message || err.response?.data;
      console.error('createUser retry because', errorMessage);
      if (errorMessage?.includes('already taken.')) {
        userPayload.makeUsernameMoreComplex();
        continue;
      }

      const RETRY_PASSWORD_STRINGS = ['The password must be at least', 'The password is too easy to guess.'];
      if (RETRY_PASSWORD_STRINGS.find(str => errorMessage?.includes(str))) {
        userPayload.regeneratePassword();
        continue;
      }

      throw err;
    }
  }

  throw new Error('could not create user ' + userPayload.contact);
}
