import Redis from 'ioredis';
import Place, { UserCreationDetails } from './place';
import ChtSession from '../lib/cht-session';
import crypto from 'crypto';

export type UploadLogRecord = {
  id: string;
  place: string;
  person: string;
  phone: string;
  contactType: string;
  credentials: UserCreationDetails;
  hierarchy: { [key: string]: string };
};

export interface UploadLogger {
  log(session: ChtSession, batchNo: number, places: Place[]): Promise<void>;
  get(session: ChtSession): Promise<UploadLogRecord[]>;
}

export interface UploadLoggerStore {
  save(user: string, batch: number, record: string[]): Promise<void>;
  get(user: string): Promise<string[]>;
}

export class RedisStore implements UploadLoggerStore {
  private readonly redis;
  constructor(redis: Redis) {
    this.redis = redis;
  }

  async save(user: String, batch: number, records: string[]): Promise<void> {
    const key = `${user}:creation-log`;
    const pipeline = this.redis.pipeline();
    records.forEach(record => {
      pipeline.zadd(key, batch, record);
      pipeline.expire(key, process.env.CREDENTIAL_LOG_TTL ?? 3600 * 120); // 5 days, running target
    });
    await pipeline.exec();
  }

  async get(username: String): Promise<string[]> {
    return this.redis.zrevrange(`${username}:creation-log`, 0, -1);
  }

}

export class UploadLoggerImpl implements UploadLogger {

  private readonly store;
  constructor(store: UploadLoggerStore) {
    this.store = store;
  }

  private encrypt = (text: string, secretKey: string) => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(
      'aes-256-gcm',
      Buffer.from(secretKey, 'hex'),
      iv
    );
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return iv.toString('hex') + ':' + authTag + ':' + encrypted;
  };

  private decrypt = (text: string, secretKey: string): string => {
    const [ivHex, authTagHex, encryptedText] = text.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      Buffer.from(secretKey, 'hex'),
      iv
    );
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  };

  log = async (session: ChtSession, batch: number, places: Place[]) => {
    const records = places.map(place => {
      const record: UploadLogRecord = {
        id: crypto.randomUUID(),
        place: place.name,
        person: place.contact.properties.name?.formatted,
        phone: place.contact.properties.phone?.formatted,
        credentials: place.creationDetails,
        contactType: place.type.name,
        hierarchy: {}
      };
      Object.keys(place.hierarchyProperties)
        .filter(k => !k.includes('replacement'))
        .forEach(prop => (record.hierarchy[prop] = place.hierarchyProperties[prop].formatted));
      return this.encrypt(JSON.stringify(record), process.env.SECRET_KEY);
    });
    await this.store.save(session.username, batch, records);
  };

  get = async (session: ChtSession): Promise<UploadLogRecord[]> => {
    const logs = await this.store.get(session.username);
    return logs.map(log => JSON.parse(this.decrypt(log, process.env.SECRET_KEY)));
  };
}
