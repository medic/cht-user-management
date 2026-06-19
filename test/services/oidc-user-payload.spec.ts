import { expect } from 'chai';

import { OidcUserPayload } from '../../src/services/oidc-user-payload';

describe('OidcUserPayload', () => {
  it('derives a CHT-safe username and carries facilities and contact', () => {
    const payload = new OidcUserPayload('Demo.User@email.com', ['chw'], ['fac-a', 'fac-b'], 'contact-1');
    expect(payload.username).to.equal('demouseremailcom');
    expect(payload.oidc_username).to.equal('Demo.User@email.com');
    expect(payload.roles).to.deep.equal(['chw']);
    expect(payload.place).to.deep.equal(['fac-a', 'fac-b']);
    expect(payload.contact).to.equal('contact-1');
  });

  it('collapses spaces and repeated separators when deriving the username', () => {
    const payload = new OidcUserPayload('Jane   Doe', ['role'], ['fac-a'], 'contact-1');
    expect(payload.username).to.equal('jane_doe');
  });

  it('carries exactly the fields needed to create the user', () => {
    const payload = new OidcUserPayload('demo@email.com', ['chw'], ['fac-a'], 'contact-1');
    expect(Object.keys({ ...payload }).sort())
      .to.deep.equal(['contact', 'oidc_username', 'place', 'roles', 'username']);
  });

  it('throws when nothing usable can be derived for the username', () => {
    expect(() => new OidcUserPayload('@@@', ['chw'], ['fac-a'], 'contact-1')).to.throw('username cannot be empty');
  });
});
