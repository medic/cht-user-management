// HTTP/HTTPS agents that override the TCP connect target for specific
// hostnames while leaving the request URL (and thus Host header / TLS SNI)
// intact — useful for SSO test scenarios

import * as http from 'http';
import * as https from 'https';

// DEV-ONLY: accept the IdP's self-signed dev cert
const httpsOptions: https.AgentOptions | undefined =
  process.env.NODE_ENV === 'dev' ? { rejectUnauthorized: false } : undefined;

export function createAliasedAgents(
  hostAliases: Record<string, string>,
): { http: http.Agent; https: https.Agent } {
  function applyHostAlias(options: any): void {
    const host = options.host as string | undefined;
    if (host && hostAliases[host]) {
      options.servername = options.servername || host;
      options.host = hostAliases[host];
    }
  }

  function createAliasedAgent<T extends http.Agent>(Base: new (opts?: any) => T, opts?: any): T {
    const Aliased = class extends (Base as any) {};
    (Aliased.prototype as any).createConnection = function (options: any, cb: any) {
      applyHostAlias(options);
      return (Base.prototype as any).createConnection.call(this, options, cb);
    };
    return new (Aliased as any)(opts) as T;
  }

  return {
    http: createAliasedAgent(http.Agent),
    https: createAliasedAgent(https.Agent, httpsOptions),
  };
}
