import chai from 'chai';
import chaiExclude from 'chai-exclude';
import jwt from 'jsonwebtoken';
import { mockChtSession } from '../mocks';
import Auth from '../../src/lib/authentication';

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

  it('worker token is encrypted and does not expose the CHT session cookie', () => {
    const session = mockChtSession();
    const encoded = Auth.encodeTokenForWorker(session);
    expect(encoded).to.match(/^enc\.v1\./);
    expect(encoded).to.not.include(session.sessionToken);
    expect(jwt.decode(encoded)).to.be.null;

    const raw = Buffer.from(encoded.slice('enc.v1.'.length), 'base64url').toString('utf8');
    expect(raw).to.not.include(session.sessionToken);
    expect(raw).to.not.include(session.username);
  });

  it('worker token encryption is non-deterministic', () => {
    const session = mockChtSession();
    expect(Auth.encodeTokenForWorker(session)).to.not.eq(Auth.encodeTokenForWorker(session));
  });

  it('tampered worker token is rejected', () => {
    const encoded = Auth.encodeTokenForWorker(mockChtSession());
    const lastChar = encoded.slice(-1) === 'A' ? 'B' : 'A';
    const tampered = encoded.slice(0, -1) + lastChar;
    expect(() => Auth.createWorkerSession(tampered)).to.throw('invalid worker token');
    expect(() => Auth.createWorkerSession('enc.v1.')).to.throw('invalid worker token');
  });

  it('legacy unencrypted worker token is still accepted', () => {
    const session = mockChtSession();
    const legacy = jwt.sign({ data: JSON.stringify(session) }, `${process.env.WORKER_PRIVATE_KEY}`, { expiresIn: '96h' });
    const decoded = Auth.createWorkerSession(legacy);
    expect(session).excluding('axiosInstance').to.deep.eq(decoded);
  });

  it('cookie token cannot be used as a worker token', () => {
    const cookieToken = Auth.encodeTokenForCookie(mockChtSession());
    expect(() => Auth.createWorkerSession(cookieToken)).to.throw('invalid signature');
  });

  it('invalid token cannot be decoded for cookie', () => {
    expect(() => Auth.createCookieSession('encoded')).to.throw('jwt malformed');
  });

  it('invalid token cannot be decoded for workers', () => {
    expect(() => Auth.createWorkerSession('encoded')).to.throw('jwt malformed');
  });

  it('invalid session cannot be decoded for cookie', () => {
    const session = {
      ...mockChtSession(),
      username: '',
      isAdmin: false,
      isPlaceAuthorized: () => false
    };
    const encoded = Auth.encodeTokenForCookie(session);
    expect(() => Auth.createCookieSession(encoded)).to.throw('invalid CHT session information');
  });

  it('invalid session cannot be decoded for workers', () => {
    const session = {
      ...mockChtSession(),
      username: '',
      isAdmin: false,
      isPlaceAuthorized: () => false
    };
    const encoded = Auth.encodeTokenForWorker(session);
    expect(() => Auth.createWorkerSession(encoded)).to.throw('invalid CHT session information');
  });
});

