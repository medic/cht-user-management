import chai from 'chai';
import chaiExclude from 'chai-exclude';
import { mockChtSession } from '../mocks';
import Auth from '../../src/lib/authentication';
import { AuthError, AuthErrors } from '../../src/lib/authentication-error';

chai.use(chaiExclude);
const { expect } = chai;

describe('lib/authentication/authentication.ts', () => {
  it('encode and decode for cookie', () => {
    const session = mockChtSession();
    const encoded = Auth.encodeTokenForCookie(session);
    const decoded = Auth.createCookieSession(encoded);
    expect(session).excluding('axiosInstance').to.deep.eq(decoded);
  });

  it('encode and decode for workers', () => {
    const session = mockChtSession();
    const encoded = Auth.encodeTokenForWorker(session);
    const decoded = Auth.createWorkerSession(encoded);
    expect(session).excluding('axiosInstance').to.deep.eq(decoded);
  });

  it('invalid token cannot be decoded for cookie', () => {
    expect(() => Auth.createCookieSession('encoded')).to.throw('jwt malformed');
  });

  it('invalid token cannot be decoded for workers', () => {
    expect(() => Auth.createWorkerSession('encoded')).to.throw('jwt malformed');
  });

  it('invalid session cannot be decoded for cookie', () => {
    const session = mockChtSession();
    delete session.username;
    const encoded = Auth.encodeTokenForCookie(session);
    expect(() => Auth.createCookieSession(encoded)).to.throw('invalid CHT session information');
  });

  it('invalid session cannot be decoded for workers', () => {
    const session = mockChtSession();
    delete session.username;
    const encoded = Auth.encodeTokenForWorker(session);
    expect(() => Auth.createWorkerSession(encoded)).to.throw('invalid CHT session information');
  });

  it('should create INVALID_CREDENTIALS error', () => {
    const error = AuthErrors.INVALID_CREDENTIALS();
    expect(error).to.be.instanceof(AuthError);
    expect(error.status).to.equal(401);
    expect(error.errorMessage).to.equal('Invalid username or password');
  });

  it('should create MISSING_CREDENTIALS error', () => {
    const error = AuthErrors.MISSING_CREDENTIALS();
    expect(error).to.be.instanceof(AuthError);
    expect(error.status).to.equal(401);
    expect(error.errorMessage).to.equal('Missing username or password');
  });
});

