import Cryptr from 'cryptr';

const cryptrConfig = { 
  saltLength: 10,
  pbkdf2Iterations: 10000, 
};

export const encryptSessionToken = (sessionToken: string, encryptionKey?: string): string => {

  if (!encryptionKey) {
    throw Error('Missing encryption key in environment variable ENCRYPTION_KEY');
  } else if (!sessionToken) {
    throw Error('Session token is empty');
  }

  const cryptr = new Cryptr(encryptionKey, cryptrConfig);
  return cryptr.encrypt(sessionToken);
};


export const decryptSessionToken = (encryptedToken: string, encryptionKey?: string): string => {

  if (!encryptionKey) {
    throw Error('Missing encryption key in environment variable ENCRYPTION_KEY');
  } else if (!encryptedToken) {
    throw Error('Encrypted token is empty');
  }

  const cryptr = new Cryptr(encryptionKey, cryptrConfig);
  return cryptr.decrypt(encryptedToken);
};
