import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import Auth from '../lib/authentication';
import { AuthError, AuthErrors } from '../lib/authentication-error';
import { Config } from '../config';
import { version as appVersion } from '../package.json';
import ChtSession from '../lib/cht-session';

export default async function authentication(fastify: FastifyInstance) {
  const unauthenticatedOptions = {
    preParsing: async (req : FastifyRequest) => {
      req.unauthenticated = true;
    },
  };

  const renderAuthForm = (resp: FastifyReply, error: string) => {
    return resp.view('src/liquid/auth/authentication_form.html', {
      domains: Config.getDomains(),
      error
    });
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

    try {
      const authInfo = Config.getAuthenticationInfo(domain);

      if (!username || !password) {
        throw AuthErrors.MISSING_CREDENTIALS();
      }

      const chtSession = await ChtSession.create(authInfo, username, password);
      const tokenizedSession = Auth.encodeTokenForCookie(chtSession);

      resp.setCookie(Auth.AUTH_COOKIE_NAME, tokenizedSession, {
        signed: false,
        httpOnly: true,
        expires: Auth.cookieExpiry(),
        secure: true
      });

      resp.header('HX-Redirect', '/');
    } catch (e: any ) {
      if (e instanceof AuthError) {
        console.error('Login error:', {
          status: e.status,
          message: e.errorMessage,
        });
        return renderAuthForm(resp, e.errorMessage);
      }

      console.error('Login error:', e);
      return renderAuthForm(resp, 'Unexpected error logging in');
    }
  });

  fastify.get('/_healthz', unauthenticatedOptions, () => {
    return 'OK';
  });

  fastify.get('/version', unauthenticatedOptions, () => {
    return appVersion;
  });
}

