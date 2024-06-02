import Chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

import { encryptSessionToken, decryptSessionToken } from '../../shared/encryption';

Chai.use(chaiAsPromised);
const { expect } = Chai;

describe('Session Token Encryption and Decryption', () => {
  const encryptionKey = 'superencryptionkey';
  const sessionToken = 'exampleSessionToken123';

  it('should encrypt and decrypt session token successfully', () => {
    const encryptedToken = encryptSessionToken(sessionToken, encryptionKey);
    const decryptedToken = decryptSessionToken(encryptedToken, encryptionKey);

    expect(encryptedToken).to.be.a('string');
    expect(decryptedToken).to.equal(sessionToken);
  });

  it('should handle empty encryption key', () => {
    const emptyKey = '';
    expect(() => encryptSessionToken(sessionToken, emptyKey)).to.throw();
  });

  it('should handle invalid encryption key', async () => {
    const invalidKey = '';
    expect(() => encryptSessionToken(sessionToken, invalidKey)).to.throw();
    expect(() => decryptSessionToken(sessionToken, invalidKey)).to.throw();
  });
});
