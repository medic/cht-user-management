import _ from 'lodash';
import { FastifyInstance } from 'fastify';

import Auth from '../lib/authentication';
import { AuthError } from '../lib/authentication-error';
import ChtSession from '../lib/cht-session';
import { Config } from '../config';

export default async function ssoLoginRoute(fastify: FastifyInstance) {
  fastify.post('/api/v1/sso-login', async (req) => {
    const formBody: any = req.body;
    ensureJsonObjectBody(formBody);

    const { domain, access_token } = formBody;
    const authInfo = Config.getAuthenticationInfo(domain);
    if (!access_token) {
      throw AuthError.MISSING_ACCESS_TOKEN();
    }

    const chtSession = await ChtSession.createFromSSO(authInfo, access_token);
    const tokenizedSession = Auth.encodeTokenForCookie(chtSession);

    return {
      ok: true,
      [Auth.AUTH_COOKIE_NAME]: tokenizedSession
    };
  });
}

function ensureJsonObjectBody(body: unknown) {
  if (!_.isPlainObject(body)) {
    throw new Error('body expected as application/json');
  }
}
