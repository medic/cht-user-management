import { FastifyInstance, FastifyRequest } from 'fastify';

import Auth from '../lib/authentication';
import { ChtApi } from '../lib/cht-api';
import { Config } from '../lib/config';

export default async function authentication(fastify: FastifyInstance) {
  const unauthenticatedOptions = {
    preParsing: async (req : FastifyRequest) => {
      req.unauthenticated = true;
    },
  };
  
  fastify.get('/login', unauthenticatedOptions, async (req, resp) => {
    const tmplData = {
      domains: Config.domains,
    };

    return resp.view('src/public/auth/view.html', tmplData);
  });

  fastify.post('/authenticate', unauthenticatedOptions, async (req, resp) => {
    const data: any = req.body;
    const { username, password, domain } = data;

    const session = await ChtApi.createSession(domain, username, password);
    if (!session.sessionToken) {
      return resp.view("src/public/auth/form.html", {
        domains: Config.domains,
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

    return resp.redirect('/');
  });
};

