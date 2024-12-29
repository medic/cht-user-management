import { FastifyInstance, FastifyRequest } from 'fastify';

import Auth from '../lib/authentication';
import { Config } from '../config';
import { version as appVersion } from '../package.json';
import ChtSession from '../lib/cht-session';

export default async function authentication(fastify: FastifyInstance) {
  const unauthenticatedOptions = {
    preParsing: async (req : FastifyRequest) => {
      req.unauthenticated = true;
    },
  };

  fastify.get('/login', unauthenticatedOptions, async (req, resp) => {
    const tmplData = {
      logo: Config.getLogoBase64(),
      domains: Config.getDomains(),
    };

    return resp.view('src/liquid/auth/view.html', tmplData);
  });

  fastify.get('/logout', unauthenticatedOptions, async (req, resp) => {
    resp.clearCookie(Auth.AUTH_COOKIE_NAME);
    return resp.redirect('/login');
  });

  fastify.post('/authenticate', unauthenticatedOptions, async (req, resp) => {
    const data: any = req.body;
    const { username, password, domain } = data;

    const authInfo = Config.getAuthenticationInfo(domain);
    let chtSession;
    try {
      chtSession = await ChtSession.create(authInfo, username, password);
    } catch (e: any) {
      console.error(`Login error: ${e}`);
      return resp.view('src/liquid/auth/authentication_form.html', {
        domains: Config.getDomains(),
        errors: true,
      });
    }

    const tokenizedSession = Auth.encodeTokenForCookie(chtSession);
    const expires = Auth.cookieExpiry();
    resp.setCookie(Auth.AUTH_COOKIE_NAME, tokenizedSession, {
      signed: false,
      httpOnly: true,
      expires,
      secure: true
    });

    resp.header('HX-Redirect', `/`);
  });

  fastify.get('/_healthz', unauthenticatedOptions, () => {
    return 'OK';
  });

  fastify.get('/version', unauthenticatedOptions, () => {
    return appVersion;
  });
}

