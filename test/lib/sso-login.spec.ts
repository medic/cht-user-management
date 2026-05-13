import Chai from 'chai';
import sinon from 'sinon';
import axios from 'axios';
import chaiAsPromised from 'chai-as-promised';

import { AuthenticationInfo } from '../../src/config';
import { ssoLogin } from '../../src/lib/sso-login';

Chai.use(chaiAsPromised);
const { expect } = Chai;

const mockAuthInfo: AuthenticationInfo = {
  friendly: 'friendly',
  domain: 'cht.example.com',
  useHttp: true,
};

const ACCESS_TOKEN = 'rsa-access-token';

const userCtxCookie = (name: string) => `userCtx=${encodeURIComponent(JSON.stringify({ name }))}`;

type StubResponse = {
  status: number;
  headers: Record<string, any>;
  data?: any;
};

function stubResponses(...responses: StubResponse[]) {
  const stub = sinon.stub(axios, 'request');
  responses.forEach((r, i) => {
    stub.onCall(i).resolves({
      status: r.status,
      headers: r.headers,
      data: r.data ?? '',
    } as any);
  });
  return stub;
}

describe('lib/sso-login.ts', () => {
  afterEach(() => sinon.restore());

  describe('ssoLogin', () => {
    it('nominal: follows redirects, returns sessionToken and username', async () => {
      const stub = stubResponses(
        // hop 0: CHT authorize -> 302 with URL in body (CHT 5.1.2 quirk)
        { status: 302, headers: {}, data: 'http://idp.example.com/oidc/auth?client_id=test-cht' },
        // hop 1: IdP authorize -> 303 to interaction
        { status: 303, headers: { location: 'http://idp.example.com/oidc-interaction/u1', 'set-cookie': ['_interaction=ix1'] } },
        // hop 2: interaction (login) -> 303 to resume
        { status: 303, headers: { location: 'http://idp.example.com/oidc/auth/u1' } },
        // hop 3: resume -> 303 to consent interaction
        { status: 303, headers: { location: 'http://idp.example.com/oidc-interaction/u2', 'set-cookie': ['_session=s1'] } },
        // hop 4: interaction (consent) -> 303 to resume
        { status: 303, headers: { location: 'http://idp.example.com/oidc/auth/u2' } },
        // hop 5: resume -> 303 back to CHT with code
        { status: 303, headers: { location: 'http://cht.example.com/medic/login/oidc?code=abc' } },
        // hop 6: CHT callback -> 302 to /admin with AuthSession + userCtx
        { status: 302, headers: { location: 'http://cht.example.com/admin/', 'set-cookie': [
          'AuthSession=session-value',
          userCtxCookie('chw-registry-service-account'),
        ] } },
        // hop 7: /admin -> 200, terminal
        { status: 200, headers: {} },
      );

      const result = await ssoLogin(mockAuthInfo, ACCESS_TOKEN);

      expect(result.sessionToken).to.eq('AuthSession=session-value');
      expect(result.username).to.eq('chw-registry-service-account');
      expect(stub.callCount).to.eq(8);
      // First hop hits CHT's authorize endpoint
      expect(stub.firstCall.args[0].url).to.eq('http://cht.example.com/medic/login/oidc/authorize');
      // Bearer header is forwarded on every hop
      stub.getCalls().forEach(call => {
        expect(call.args[0].headers.Authorization).to.eq(`Bearer ${ACCESS_TOKEN}`);
      });
    });

    it('replays cookies on subsequent requests to the same host', async () => {
      const stub = stubResponses(
        { status: 302, headers: { location: 'http://cht.example.com/medic/login/oidc?code=abc', 'set-cookie': ['_extra=foo'] } },
        { status: 200, headers: { 'set-cookie': ['AuthSession=tok', userCtxCookie('rsa')] } },
      );

      await ssoLogin(mockAuthInfo, ACCESS_TOKEN);

      // Second hop must include the cookie set on the first.
      const secondHopHeaders = stub.getCall(1).args[0].headers;
      expect(secondHopHeaders.Cookie).to.include('_extra=foo');
    });

    it('honors Location header when present (not just body)', async () => {
      const stub = stubResponses(
        { status: 303, headers: { location: 'http://cht.example.com/medic/login/oidc?code=z' } },
        { status: 200, headers: { 'set-cookie': ['AuthSession=tok', userCtxCookie('rsa')] } },
      );

      await ssoLogin(mockAuthInfo, ACCESS_TOKEN);
      expect(stub.getCall(1).args[0].url).to.eq('http://cht.example.com/medic/login/oidc?code=z');
    });

    it('throws if no AuthSession cookie ever set for the CHT host', async () => {
      stubResponses(
        { status: 200, headers: { 'set-cookie': [userCtxCookie('rsa')] } },
      );

      await expect(ssoLogin(mockAuthInfo, ACCESS_TOKEN))
        .to.eventually.be.rejectedWith(/no AuthSession cookie was set/);
    });

    it('throws if no userCtx cookie set', async () => {
      stubResponses(
        { status: 200, headers: { 'set-cookie': ['AuthSession=tok'] } },
      );

      await expect(ssoLogin(mockAuthInfo, ACCESS_TOKEN))
        .to.eventually.be.rejectedWith(/no userCtx cookie was set/);
    });

    it('throws if userCtx is malformed JSON', async () => {
      stubResponses(
        { status: 200, headers: { 'set-cookie': ['AuthSession=tok', 'userCtx=%7Bnot-json'] } },
      );

      await expect(ssoLogin(mockAuthInfo, ACCESS_TOKEN))
        .to.eventually.be.rejectedWith(/userCtx cookie has no usable name/);
    });

    it('throws if userCtx has no name field', async () => {
      stubResponses(
        { status: 200, headers: { 'set-cookie': ['AuthSession=tok', `userCtx=${encodeURIComponent('{}')}`] } },
      );

      await expect(ssoLogin(mockAuthInfo, ACCESS_TOKEN))
        .to.eventually.be.rejectedWith(/userCtx cookie has no usable name/);
    });

    it('throws on non-redirect non-2xx', async () => {
      stubResponses(
        { status: 500, headers: {}, data: 'kaboom' },
      );

      await expect(ssoLogin(mockAuthInfo, ACCESS_TOKEN))
        .to.eventually.be.rejectedWith(/HTTP 500/);
    });

    it('throws when the redirect chain exceeds max hops', async () => {
      const stub = sinon.stub(axios, 'request');
      // Always redirect to itself
      stub.resolves({
        status: 303,
        headers: { location: 'http://cht.example.com/loop' },
        data: '',
      } as any);

      await expect(ssoLogin(mockAuthInfo, ACCESS_TOKEN))
        .to.eventually.be.rejectedWith(/exceeded \d+ hops/);
    });

    it('uses https when useHttp is false', async () => {
      const httpsAuth: AuthenticationInfo = { ...mockAuthInfo, useHttp: false };
      const stub = stubResponses(
        { status: 200, headers: { 'set-cookie': ['AuthSession=tok', userCtxCookie('rsa')] } },
      );

      await ssoLogin(httpsAuth, ACCESS_TOKEN);
      expect(stub.firstCall.args[0].url).to.eq('https://cht.example.com/medic/login/oidc/authorize');
    });
  });
});
