import { AxiosError, AxiosRequestConfig } from 'axios';
import isRetryAllowed from 'is-retry-allowed';
import { UserPayload } from '../services/user-payload';
import { ChtApi } from './cht-api';

const RETRY_COUNT = 4;

export const axiosRetryConfig = {
  retries: RETRY_COUNT,
  retryDelay: () => 1000,
  retryCondition: (err: AxiosError) => {
    const status = err.response?.status;
    return (!status || status >= 500) && isRetryAllowed(err);
  },
  onRetry: (retryCount: number, error: AxiosError, requestConfig: AxiosRequestConfig) => {
    console.log(`${requestConfig.url} failure. Retrying (${retryCount})`);
  },
};

export async function retryOnUpdateConflict<T>(funcWithPut: () => Promise<T>): Promise<T> {
  for (let retryCount = 0; retryCount < RETRY_COUNT; retryCount++) {
    try {
      return await funcWithPut();
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

      const translationKey = err.response?.data?.error?.translationKey;
      console.error('createUser retry because', translationKey);
      if (translationKey === 'username.taken') {
        userPayload.makeUsernameMoreComplex();
        continue;
      }

      const RETRY_PASSWORD_TRANSLATIONS = ['password.length.minimum', 'password.weak'];
      if (RETRY_PASSWORD_TRANSLATIONS.includes(translationKey)) {
        userPayload.regeneratePassword();
        continue;
      }

      throw err;
    }
  }

  throw new Error('could not create user ' + userPayload.contact);
}
