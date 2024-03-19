import { expect } from 'chai';
import { mockChtSession } from '../mocks';
import Auth from '../../dist/lib/authentication';

describe('lib/authentication.ts', () => {
  it('encode and decode', () => {
    const session = mockChtSession();
    const encoded = Auth.encodeToken(session);
    const decoded = Auth.decodeToken(encoded);
    expect(session).to.deep.eq(decoded);
  });

  it('invalid token cannot be decoded', () => {
    expect(() => Auth.decodeToken('encoded')).to.throw('jwt malformed');
  });

  it('invalid session cannot be decoded', () => {
    const session = mockChtSession();
    delete session.username;
    const encoded = Auth.encodeToken(session);
    expect(() => Auth.decodeToken(encoded)).to.throw('invalid CHT session information');
  });
});

