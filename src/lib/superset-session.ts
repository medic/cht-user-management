import axios, { AxiosInstance } from 'axios';
import { Config } from '../config';

export class SupersetSession {
  public sessionToken!: string;
  public csrfToken!: string;
  public cookie!: string;
  public axiosInstance: AxiosInstance;

  private constructor(axiosInstance: AxiosInstance) {
    this.axiosInstance = axiosInstance;
  }

  public static async create(): Promise<SupersetSession> {
    const baseUrl = Config.getSupersetBaseUrl().replace(/\/+$/, '');

    const axiosInstance = axios.create({
      baseURL: `${baseUrl}/api/v1`,
    });

    const session = new SupersetSession(axiosInstance);
    
    // Perform login and initialize session tokens
    await session.initializeSession();
    
    return session;
  }

  // Initialize session: login, get tokens, set headers
  private async initializeSession(): Promise<void> {
    // Step 1: Login to get the session token (Bearer Token)
    const loginUrl = `/security/login`;
    const { username, password } = Config.getSupersetCredentials();
    
    const loginResponse = await this.axiosInstance.post(loginUrl, {
      username: username,
      password: password,
      provider: 'db',
    });
    console.log('axios.post', loginUrl);
    
    this.sessionToken = loginResponse.data.access_token;

    // Step 2: Get CSRF Token and Cookie
    const csrfUrl = `/security/csrf_token/`;
    const csrfResponse = await this.axiosInstance.get(csrfUrl, {
      headers: {
        Authorization: `Bearer ${this.sessionToken}`,
      },
    });
    console.log('axios.get', csrfUrl);


    this.csrfToken = csrfResponse.data.result;
    this.cookie = Array.isArray(csrfResponse.headers['set-cookie'])
      ? csrfResponse.headers['set-cookie'].join('; ')
      : csrfResponse.headers['set-cookie'] || '';

    // Step 3: Set axios default headers with tokens and cookies
    this.axiosInstance.defaults.headers.common = this.getFormattedHeaders();
  }

  private getFormattedHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.sessionToken}`,
      'Content-Type': 'application/json',
      'X-CSRFToken': this.csrfToken,
      Cookie: this.cookie,
      Referer: Config.getSupersetBaseUrl(),
      Origin: Config.getSupersetBaseUrl(),
    };
  }
}
