import axios from 'axios';
import { ExternalSource } from '../config';
import ExternalSourceService from './external-source';

export type ExternalSourceAuth = {
  id: string;
  url: string;
  type: 'token' | 'basic';
  token_endpoint?: string;
  token: string | null;
  mapping?: { client_id: string; client_secret: string };
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
        token: null,
        token_endpoint: source.auth.token_endpoint,
        mapping: source.auth.mapping,
        expiresAt: 0,
        expiration: source.auth.expiration || 0,
        refreshingToken: null
      };
    });
  }

  async getAuth(externalSourceId: string): Promise<string> {
    const authType = this.externalSourceAuth[externalSourceId].type;
    const token = await this.getToken(externalSourceId);
    if (authType === 'basic') {
      return `Basic ${token}`;
    }
    return `Bearer ${token}`;
  }

  private async getToken(externalSourceId: string): Promise<string | null> {
    const secretKey = `${externalSourceId}_SECRET`.toUpperCase();
    const tokenSecret = process.env[secretKey];

    if (this.externalSourceAuth[externalSourceId].type === 'basic') {
      if (!tokenSecret) {
        throw new Error(`${secretKey} not set`);
      }
      return tokenSecret;
    }

    const now = Date.now();
    const expiresAt = this.externalSourceAuth[externalSourceId].expiresAt;
    const currentToken = this.externalSourceAuth[externalSourceId].token;
    if (currentToken && expiresAt > now) {
      console.log('using cached token for external source: ', externalSourceId);
      return currentToken;
    }

    if (this.externalSourceAuth[externalSourceId].refreshingToken) {
      return this.externalSourceAuth[externalSourceId].refreshingToken;
    }

    this.externalSourceAuth[externalSourceId].refreshingToken = this.fetchToken(externalSourceId, tokenSecret);
    try {
      this.externalSourceAuth[externalSourceId].token = await this.externalSourceAuth[externalSourceId].refreshingToken as string;
      this.externalSourceAuth[externalSourceId].expiresAt = now + (this.externalSourceAuth[externalSourceId].expiration) * 1000;
      return this.externalSourceAuth[externalSourceId].token || null;
    } finally {
      this.externalSourceAuth[externalSourceId].refreshingToken = null;
    }
  }

  private async fetchToken(externalSourceId: string, tokenSecret: string = ''): Promise<string> {
    try {
      if (!tokenSecret) {
        throw new Error(`${externalSourceId}_SECRET not set`);
      }

      const [clientId, clientSecret] = Buffer.from(tokenSecret, 'base64').toString('utf-8').split(':');
      const baseUrl = this.externalSourceAuth[externalSourceId].url;
      const tokenUrl = this.externalSourceAuth[externalSourceId].token_endpoint || '';
      const url = ExternalSourceService.buildUrl(baseUrl, tokenUrl);
      const payLoad = {
        [this.externalSourceAuth[externalSourceId].mapping?.client_id || 'client_id']: clientId,
        [this.externalSourceAuth[externalSourceId].mapping?.client_secret || 'client_secret']: clientSecret,
        timeout: 10_000,
      };

      console.log('axios.post: token for external source ', externalSourceId);
      const response = await axios.post(url, payLoad);
      return response.data.access_token || response.data.token;
    } catch (error) {
      console.error('error', error);
      return '';
    }
  }

}
