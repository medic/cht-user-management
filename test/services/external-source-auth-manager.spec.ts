import Chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import axios from 'axios';

import { ExternalSource } from '../../src/config';
import ExternalSourceAuthManager from '../../src/services/external-source-auth-manager';

Chai.use(chaiAsPromised);
const { expect } = Chai;

const SOURCE_ID = 'source-a';
const SECRET_KEY = `${SOURCE_ID}_SECRET`.toUpperCase();
const TOKEN_SECRET = Buffer.from('my-client:my-secret', 'utf-8').toString('base64');

const mockSource = (overrides: Partial<ExternalSource> = {}): ExternalSource => ({
  id: SOURCE_ID,
  friendly_name: 'Source A',
  url: 'https://example.com',
  api_endpoint: '/api/search',
  resultKey: 'results',
  auth: {
    type: 'token',
    token_endpoint: '/oauth/token',
    expiration: 5,
    client_id: 'client_id',
    client_secret: 'client_secret',
    ...overrides.auth,
  },
  ...overrides,
});

describe('services/external-source-auth-manager.ts', () => {
  afterEach(() => {
    sinon.restore();
    delete process.env[SECRET_KEY];
  });

  describe('basic auth', () => {
    it('returns a Basic header using the raw secret', async () => {
      process.env[SECRET_KEY] = 'raw-secret';
      const basicSource = mockSource({ auth: { type: 'basic', client_id: 'client_id', client_secret: 'client_secret' } });
      const manager = new ExternalSourceAuthManager([basicSource]);
      const post = sinon.stub(axios, 'post');

      const auth = await manager.getAuth(SOURCE_ID);
      expect(auth).to.eq('Basic raw-secret');
      expect(post.notCalled).to.be.true;
    });
  });

  describe('token auth', () => {
    it('throws when the secret env var is not set', async () => {
      const manager = new ExternalSourceAuthManager([mockSource()]);
      await expect(manager.getAuth(SOURCE_ID)).to.be.rejectedWith(`${SECRET_KEY} not set`);
    });

    it('fetches a token and returns a Bearer header', async () => {
      process.env[SECRET_KEY] = TOKEN_SECRET;
      const manager = new ExternalSourceAuthManager([mockSource()]);
      const post = sinon.stub(axios, 'post').resolves({ data: { access_token: 'tok-123' } } as any);

      const auth = await manager.getAuth(SOURCE_ID);

      expect(auth).to.eq('Bearer tok-123');
      expect(post.calledOnce).to.be.true;
      expect(post.firstCall.args[0]).to.eq('https://example.com/oauth/token');
      expect(post.firstCall.args[1]).to.deep.eq({ client_id: 'my-client', client_secret: 'my-secret' });
    });

    it('accepts a "token" field in the response', async () => {
      process.env[SECRET_KEY] = TOKEN_SECRET;
      const manager = new ExternalSourceAuthManager([mockSource()]);
      sinon.stub(axios, 'post').resolves({ data: { token: 'tok-from-token-field' } } as any);

      const auth = await manager.getAuth(SOURCE_ID);
      expect(auth).to.eq('Bearer tok-from-token-field');
    });

    it('reuses a cached token while it is still valid', async () => {
      process.env[SECRET_KEY] = TOKEN_SECRET;
      const manager = new ExternalSourceAuthManager([mockSource()]);
      const post = sinon.stub(axios, 'post').resolves({ data: { access_token: 'tok-123' } } as any);

      await manager.getAuth(SOURCE_ID);
      await manager.getAuth(SOURCE_ID);

      expect(post.calledOnce).to.be.true;
    });

    it('refetches once the cached token has expired', async () => {
      const clock = sinon.useFakeTimers();
      process.env[SECRET_KEY] = TOKEN_SECRET;
      const manager = new ExternalSourceAuthManager([mockSource()]);
      const post = sinon.stub(axios, 'post')
        .onFirstCall().resolves({ data: { access_token: 'tok-1' } } as any)
        .onSecondCall().resolves({ data: { access_token: 'tok-2' } } as any);

      const firstCall = await manager.getAuth(SOURCE_ID);
      // expiration is 5 minutes. Move forward 6 minutes
      clock.tick(6 * 60_000);
      const secondCall = await manager.getAuth(SOURCE_ID);

      expect(firstCall).to.eq('Bearer tok-1');
      expect(secondCall).to.eq('Bearer tok-2');
      expect(post.calledTwice).to.be.true;
      clock.restore();
    });

    it('shares a single in-flight request across concurrent callers', async () => {
      process.env[SECRET_KEY] = TOKEN_SECRET;
      const manager = new ExternalSourceAuthManager([mockSource()]);
      const post = sinon.stub(axios, 'post').resolves({ data: { access_token: 'tok-123' } } as any);

      const [a, b] = await Promise.all([manager.getAuth(SOURCE_ID), manager.getAuth(SOURCE_ID)]);

      expect(a).to.eq('Bearer tok-123');
      expect(b).to.eq('Bearer tok-123');
      expect(post.calledOnce).to.be.true;
    });

    it('throws when the token endpoint returns no token', async () => {
      process.env[SECRET_KEY] = TOKEN_SECRET;
      const manager = new ExternalSourceAuthManager([mockSource()]);
      sinon.stub(axios, 'post').resolves({ data: {} } as any);
      sinon.stub(axios, 'isAxiosError').returns(false);

      await expect(manager.getAuth(SOURCE_ID)).to.be
        .rejectedWith(`Token endpoint for "${SOURCE_ID}" returned no access_token/token`);
    });

    it('propagates errors from the token endpoint', async () => {
      process.env[SECRET_KEY] = TOKEN_SECRET;
      const manager = new ExternalSourceAuthManager([mockSource()]);
      sinon.stub(axios, 'post').rejects(new Error('network down'));
      sinon.stub(axios, 'isAxiosError').returns(false);

      await expect(manager.getAuth(SOURCE_ID)).to.be.rejectedWith('network down');
    });
  });
});
