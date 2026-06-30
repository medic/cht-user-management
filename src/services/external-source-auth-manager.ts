import axios from 'axios';
import { ExternalSource } from '../config';
import ExternalSourceService from './external-source';

export type ExternalSourceAuth = {
  id: string;
  url: string;
  type: 'token' | 'basic';
  token_endpoint?: string;
  token?: string;
  client_id_key: string;
  client_secret_key: string;
  expiresAt: number;
  expiration: number;
  refreshingToken: Promise<string> | null;
}

export default class ExternalSourceAuthManager {
  private externalSourceAuth: Record<string, ExternalSourceAuth> = {};

  constructor(config: ExternalSource[]) {
    config.forEach(source => {
      this.externalSourceAuth[source.id] = {
        id: source.id,
        url: source.url,
        type: source.auth.type === 'token' ? 'token' : 'basic',
        token_endpoint: source.auth.token_endpoint,
        client_id_key: source.auth.client_id_key,
        client_secret_key: source.auth.client_secret_key,
        expiresAt: 0,
        expiration: source.auth.expiration || 0,
        refreshingToken: null
      };
    });
  }

  async getAuth(externalSourceId: string): Promise<string> {
    const { type } = this.externalSourceAuth[externalSourceId];
    const token = await this.getToken(externalSourceId);
    if (!token) {
      throw new Error(`Authentication error`);
    }
    return type === 'token' ? `Bearer ${token}` : `Basic ${token}`;
  }

  private async getToken(externalSourceId: string): Promise<string> {
    const secretKey = `${externalSourceId}_SECRET`.toUpperCase();
    const tokenSecret = process.env[secretKey];
    if (!tokenSecret) {
      throw new Error(`${secretKey} not set`);
    }

    if (this.externalSourceAuth[externalSourceId].type === 'basic') {
      return tokenSecret;
    }

    const expiresAt = this.externalSourceAuth[externalSourceId].expiresAt;
    const currentToken = this.externalSourceAuth[externalSourceId].token;
    const now = Date.now();
    if (currentToken && expiresAt > now) {
      console.log('using cached token for external source: ', externalSourceId);
      return currentToken;
    }

    if (this.externalSourceAuth[externalSourceId].refreshingToken) {
      return this.externalSourceAuth[externalSourceId].refreshingToken as Promise<string>;
    }

    this.externalSourceAuth[externalSourceId].refreshingToken = this.fetchToken(externalSourceId, tokenSecret);
    try {
      const result = await this.externalSourceAuth[externalSourceId].refreshingToken as string;
      this.externalSourceAuth[externalSourceId].token = result;
      this.externalSourceAuth[externalSourceId].expiresAt = now + (this.externalSourceAuth[externalSourceId].expiration) * 60_000;
      return this.externalSourceAuth[externalSourceId].token as string;
    } finally {
      this.externalSourceAuth[externalSourceId].refreshingToken = null;
    }
  }

  private async fetchToken(externalSourceId: string, tokenSecret: string = ''): Promise<string> {
    const [clientId, clientSecret] = Buffer.from(tokenSecret, 'base64').toString('utf-8').split(':');
    const baseUrl = this.externalSourceAuth[externalSourceId].url;
    const tokenUrl = this.externalSourceAuth[externalSourceId].token_endpoint || '';
    const url = ExternalSourceService.buildUrl(baseUrl, tokenUrl);
    const payLoad = {
      [this.externalSourceAuth[externalSourceId].client_id_key || 'client_id']: clientId,
      [this.externalSourceAuth[externalSourceId].client_secret_key || 'client_secret']: clientSecret,
    };

    console.log('axios.post: token for external source ', externalSourceId, url);
    try {
      const response = await axios.post(url, payLoad, { timeout: 10_000 });
      const token = response.data.access_token || response.data.token;
      if (!token) {
        throw new Error(`Token endpoint for "${externalSourceId}" returned no access_token/token`);
      }
      return token;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error('Axios error:', {
          message: error.message,
          response: error.response?.data,
        });
      }
      throw error;
    }
  }

}
