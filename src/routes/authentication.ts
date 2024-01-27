import { FastifyInstance, FastifyRequest } from 'fastify';

import Auth from '../lib/authentication';
import { ChtApi } from '../lib/cht-api';
import { Config } from '../config';
import { version as appVersion } from '../package.json';

export default async function authentication(fastify: FastifyInstance) {
  const unauthenticatedOptions = {
    preParsing: async (req : FastifyRequest) => {
      req.unauthenticated = true;
    },
  };

  fastify.get('/plugin/user-management/login', unauthenticatedOptions, async (req, resp) => {
    const tmplData = {
      logo: Config.getLogoBase64(),
      domains: Config.getDomains,
    };

    return resp.view('src/public/auth/view.html', tmplData);
  });

  fastify.get('/plugin/user-management/logout', unauthenticatedOptions, async (req, resp) => {
    resp.clearCookie(Auth.AUTH_COOKIE_NAME);
    return resp.redirect('/login');
  });

  fastify.post('/plugin/user-management/authenticate', unauthenticatedOptions, async (req, resp) => {
    const data: any = req.body;
    const { username, password, domain } = data;

    const authInfo = Config.getAuthenticationInfo(domain);
    let session;
    try {
      session = await ChtApi.createSession(authInfo, username, password);
    } catch (e: any) {
      return resp.view('src/public/auth/authentication_form.html', {
        domains: Config.getDomains,
        errors: true,
      });
    }

    const tokenizedSession = Auth.encodeToken(session);
    const expires = Auth.cookieExpiry();
    resp.setCookie(Auth.AUTH_COOKIE_NAME, tokenizedSession, {
      signed: false,
      httpOnly: true,
      expires,
      secure: true
    });

    resp.header('HX-Redirect', `/plugin/user-management/`);
  });

  fastify.get('/plugin/user-management/_healthz', unauthenticatedOptions, () => {
    return 'OK';
  });

  fastify.get('/plugin/user-management/version', unauthenticatedOptions, () => {
    return appVersion;
  });
}

