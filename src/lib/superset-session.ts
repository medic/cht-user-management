import { AxiosInstance } from 'axios';
import { Config } from '../config';
const axios = require('axios');

const REQUEST_TIMEOUT = 10000; // 10 seconds timeout for API requests
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second

export default class SupersetSession {
  public readonly axiosInstance: AxiosInstance;
  private sessionToken: string = '';
  private csrfToken: string = '';
  private cookie: string = '';

  private constructor(baseURL: string) {
    this.axiosInstance = axios.create({
      baseURL,
      timeout: REQUEST_TIMEOUT,
      headers: {
        'Content-Type': 'application/json',
      },
      withCredentials: true,
    });
  }

  /**
   * Creates and initializes a new Superset session
   */
  public static async create(): Promise<SupersetSession> {
    const baseUrl = Config.getSupersetBaseUrl().replace(/\/+$/, '');
    const session = new SupersetSession(`${baseUrl}/api/v1`);
    await session.initializeSession();
    return session;
  }

  /**
   * Initializes the session with proper token sequence
   * @throws Error if initialization fails after max retries
   */
  private async initializeSession(retryCount = 0): Promise<void> {
    try {
      // Step 1: Login to get session token
      await this.login();
      // Step 2: Get CSRF token using session token
      await this.fetchCsrfToken();
      // Step 3: Setup axios defaults with all tokens
      this.setupAxiosDefaults();
    } catch (error: any) {
      if (retryCount < MAX_RETRIES) {
        // Exponential backoff: each retry waits longer than the previous one
        await this.delay(RETRY_DELAY * (retryCount + 1));
        await this.initializeSession(retryCount + 1);
      } else {
        throw new Error(`Failed to initialize Superset session after ${MAX_RETRIES} attempts: ${error.message}`);
      }
    }
  }

  /**
   * Authenticates with Superset to get session token
   */
  private async login(): Promise<void> {
    const { username, password } = Config.getSupersetCredentials();
    const loginResponse = await this.axiosInstance.post('/security/login', {
      username,
      password,
      provider: 'db',
      refresh: true,
    });

    this.sessionToken = loginResponse.data.access_token;
    if (!this.sessionToken) {
      throw new Error('Failed to obtain session token from Superset');
    }
  }

  /**
   * Fetches CSRF token using session token
   */
  private async fetchCsrfToken(): Promise<void> {
    const csrfResponse = await this.axiosInstance.get('/security/csrf_token/', {
      headers: { Authorization: `Bearer ${this.sessionToken}` },
    });

    this.csrfToken = csrfResponse.data.result;
    // Handle both array and string cookie formats from Superset
    this.cookie = Array.isArray(csrfResponse.headers['set-cookie'])
      ? csrfResponse.headers['set-cookie'].join('; ')
      : csrfResponse.headers['set-cookie'] || '';

    if (!this.csrfToken || !this.cookie) {
      throw new Error('Failed to obtain CSRF token or cookie from Superset');
    }
  }

  /**
   * Sets up axios defaults with all required tokens and headers
   */
  private setupAxiosDefaults(): void {
    this.axiosInstance.defaults.headers.common = {
      Authorization: `Bearer ${this.sessionToken}`,
      'Content-Type': 'application/json',
      'X-CSRFToken': this.csrfToken,
      Cookie: this.cookie,
      Referer: Config.getSupersetBaseUrl(),
      Origin: Config.getSupersetBaseUrl(),
    };
  }

  /**
   * Utility method to delay execution
   * @param ms Milliseconds to delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
