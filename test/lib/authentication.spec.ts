import chai from 'chai';
import chaiExclude from 'chai-exclude';
import { mockChtSession } from '../mocks';
import Auth from '../../src/lib/authentication';

chai.use(chaiExclude);
const { expect } = chai;

describe('lib/authentication.ts', () => {
  it('encode and decode', () => {
    const session = mockChtSession();
    const encoded = Auth.encodeToken(session);
    const decoded = Auth.decodeToken(encoded);
    expect(session).excluding('axiosInstance').to.deep.eq(decoded);
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

