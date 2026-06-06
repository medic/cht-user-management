import axios from 'axios';
import { ExternalSource } from '../config';
import ExternalSourceService from './external-source';

export type ExternalSourceAuth = {
  id: string;
  url: string;
  type: 'token' | 'basic';
  token_endpoint?: string;
  token?: string;
  expiresAt?: number;
  expiration?: number;
  refresh_token?: Promise<string> | null;
}

export default class AuthTokenManager {
  private externalSourceAuth: Record<string, ExternalSourceAuth> = {};

  constructor(config: ExternalSource[]) {
    config.forEach(source => {
      this.externalSourceAuth[source.id] = {
        id: source.id,
        url: source.url,
        type: source.auth.type === 'token' ? 'token' : 'basic',
        token_endpoint: source.auth.token_endpoint,
        expiration: source.auth.expiration,
        refresh_token: null
      };
    });
    console.log('zzzzzzzzzzzzzzzzzzzzzzzzzzzz', this.externalSourceAuth);
  }

  /* async getAuth(externalSourceId: string): Promise<ExternalSourceAuth> {
    return this.externalSourceAuth[externalSourceId];
  } */

  async getToken(externalSourceId: string): Promise<string | null> {
    if (this.externalSourceAuth[externalSourceId].type === 'basic') {
      const secretKey = `${externalSourceId}_SECRET`.toUpperCase();
      const token = process.env[secretKey];
      if (!token) {
        throw new Error(`${secretKey} not set`);
      }
      return token;
    }

    const now = Date.now();
    const expiresAt = this.externalSourceAuth[externalSourceId].expiresAt;
    const currentToken = this.externalSourceAuth[externalSourceId].token;
    if (currentToken && expiresAt && expiresAt > now) {
      return currentToken;
    }

    this.externalSourceAuth[externalSourceId].refresh_token = this.fetchToken(externalSourceId);

    try {
      return await this.externalSourceAuth[externalSourceId].refresh_token as string;
    } finally {
      this.externalSourceAuth[externalSourceId].refresh_token = null;
    }
    //return null;
  }

  private async fetchToken(externalSourceId: string): Promise<string> {
    const baseUrl = this.externalSourceAuth[externalSourceId].url;
    const tokenUrl = this.externalSourceAuth[externalSourceId].token_endpoint || '';
    const url = ExternalSourceService.buildUrl(baseUrl, tokenUrl);
    console.log('ftechinnnnnnnnnnnnnnnnnnnnnnnnnnnnnn', url);
    try {
      const response = await axios.post(
        url,
        {
          auth: { },
          timeout: 10_000,
        }
      );
      console.log('response}}}}}}}}}}}}}}}}}}}}}}}}]] >', response.data);
      return response.data.access_token;
    } catch (error) {
      console.error('error', error);
    }
    return 'zzzzz';
    
  }

  /* async getToken(externalSourceId: string, tokenUrl: string): Promise<string | null> {
    const now = Date.now();
    console.log('------------', tokenUrl);
    if (this.accessTokens[externalSourceId] && this.expiresAt[externalSourceId] > now) {
      return this.accessTokens[externalSourceId];
    }

    if (this.refreshToken[externalSourceId]) {
      return this.refreshToken[externalSourceId];
    }
    return null;

    this.refreshToken[externalSourceId] = fetchToken(tokenUrl);

    try {
      return await this.refreshToken[externalSourceId];
    } finally {
      this.refreshToken[externalSourceId] = null;
    }

  } */

  /* private async fetchToken(tokenUrl: string): Promise<string> {
    const response = await axios.post(
      tokenUrl,
      {
        auth: { username: 'admin', password: 'secret' },
        timeout: 10 * 1000,
      }
    );
  } */

}
